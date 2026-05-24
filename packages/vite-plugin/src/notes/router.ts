// Attention router for task-mode notes (option C of the proposal).
//
// Subscribes to the event bus, claims tasks as they arrive, spawns
// `claude` headlessly with a constructed prompt + tool access, and
// observes the resulting status transitions. One task at a time —
// concurrent solves queue serially so we don't compete with each
// other for the same diff.
//
// The spawner is injectable so tests don't actually shell out to
// claude. The real spawner ships `claude --print "$prompt"` from
// the project root; claude inherits the project's `.mcp.json` and so
// has `llui_reply_to_note` available to post the result back into
// the notebook.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { EventBus, SseEventListener } from './event-bus.js'
import { listNotes, readNote } from './store.js'
import { appendStatus, currentStatus, readStatusHistory } from './status.js'
import { serializeNote } from './frontmatter.js'
import type { ServerEvent, StatusTransition } from './types.js'

export interface ClaudeSpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

export interface ClaudeSpawner {
  /** Run claude with the given prompt + cwd. Returns when the
   *  process exits or the timeout fires. */
  spawn(opts: { prompt: string; cwd: string; timeoutMs: number }): Promise<ClaudeSpawnResult>
}

export interface RouterConfig {
  /** Path of the .llui/notes/ root. */
  notesRoot: string
  /** Working directory passed to spawned claude — the project root.
   *  Claude inherits `CLAUDE.md` and `.mcp.json` from here. */
  projectRoot: string
  /** Event bus to subscribe to. */
  bus: EventBus
  /** Spawner — defaults to the real `claude --print` spawner. */
  spawner?: ClaudeSpawner
  /** Per-task timeout in ms. Default 5 minutes — long enough for
   *  most file edits, short enough that a hung claude doesn't strand
   *  the router. */
  timeoutMs?: number
  /** Logger; defaults to console.error. */
  log?: (msg: string) => void
}

export interface RouterHandle {
  /** Stop the router. Currently-running task continues but no new
   *  tasks will be claimed. */
  stop(): void
  /** Number of tasks pending in the internal queue. Test affordance. */
  queueLength(): number
  /** Whether a task is currently being processed. Test affordance. */
  isBusy(): boolean
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Spawn `claude --print --output-format text` headlessly. Returns
 * when the process exits, or kills it after `timeoutMs` and reports
 * `timedOut: true`.
 *
 * `--print` is the non-interactive flag (read prompt from stdin or
 * the trailing positional, emit response to stdout, exit). We also
 * pass `--dangerously-skip-permissions` so the spawned process can
 * use Edit/Write/Bash without an interactive approval prompt — this
 * is acceptable for the dev-mode router (the user opted in by
 * clicking "Solve" in their own dev environment).
 */
export const defaultClaudeSpawner: ClaudeSpawner = {
  async spawn({ prompt, cwd, timeoutMs }) {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const child: ChildProcess = spawn(
        'claude',
        ['--print', '--dangerously-skip-permissions', '--output-format', 'text'],
        {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        },
      )
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      const killer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
      child.on('error', (err) => {
        clearTimeout(killer)
        resolve({ exitCode: -1, stdout, stderr: stderr + String(err), timedOut })
      })
      child.on('exit', (code) => {
        clearTimeout(killer)
        resolve({ exitCode: code ?? -1, stdout, stderr, timedOut })
      })
      // Send the prompt over stdin then close it.
      child.stdin?.end(prompt + '\n', 'utf8')
    })
  },
}

/**
 * Probe whether `claude` is available on PATH. We don't care about
 * the version — only that the binary exists. If not, the router
 * still starts (and logs a clear "not installed" message) but never
 * actually spawns anything, so installed-or-not is a graceful
 * downgrade rather than a crash.
 */
export function isClaudeAvailable(): boolean {
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    if (existsSync(join(dir, 'claude'))) return true
  }
  return false
}

const ROUTER_WORKER_ID = 'llui-router'

/**
 * Build the prompt fed to claude. Mirrors what an interactive Claude
 * would see if a developer dropped the note into chat manually:
 * frontmatter context, prose, plus an instruction to file a reply.
 */
function buildPrompt(sessionId: string, noteId: string, notesRoot: string): string {
  const note = readNote(notesRoot, sessionId, noteId)
  const fm = note.frontmatter
  const body = note.body

  const lines: string[] = []
  lines.push(
    `You have a task from the LLui devmode-annotate notebook. Read it carefully and solve it.`,
  )
  lines.push('')
  lines.push(`## Task — note ${noteId} (session ${sessionId})`)
  lines.push('')
  lines.push(`**URL:** ${fm.url}`)
  if (fm.route) lines.push(`**Route:** ${fm.route}`)
  if (fm.componentPath?.length) lines.push(`**Components mounted:** ${fm.componentPath.join(', ')}`)
  if (fm.componentMeta) {
    lines.push(
      `**Primary component:** ${fm.componentMeta.name} (\`${fm.componentMeta.file}:${fm.componentMeta.line}\`)`,
    )
  }
  if (fm.annotations.length > 0) {
    lines.push(`**Annotations:** ${fm.annotations.map((a) => a.type).join(', ')}`)
  }
  if (fm.screenshot) {
    lines.push(`**Screenshot:** \`.llui/notes/${sessionId}/${fm.screenshot}\``)
  }
  lines.push('')
  lines.push('### What the developer said')
  lines.push('')
  lines.push(note.prose || '_(no prose; rely on the annotation/screenshot)_')
  lines.push('')

  if (body.sourceMap && body.sourceMap.length > 0) {
    lines.push('### Source map (elements inside the annotated region)')
    for (const entry of body.sourceMap) {
      lines.push(`- \`${entry.file}:${entry.line}\` — selector \`${entry.selector}\``)
    }
    lines.push('')
  }
  if (body.stateSnapshot && Object.keys(body.stateSnapshot).length > 0) {
    lines.push('### State at capture time')
    lines.push('```json')
    lines.push(JSON.stringify(body.stateSnapshot, null, 2))
    lines.push('```')
    lines.push('')
  }
  if (body.messageLog && body.messageLog.length > 0) {
    lines.push(`### Recent messages (${body.messageLog.length})`)
    for (const m of body.messageLog.slice(-10)) {
      lines.push(`- \`${m.component}\`: ${JSON.stringify(m.msg)}`)
    }
    lines.push('')
  }

  lines.push('### Your job')
  lines.push('')
  lines.push(
    `1. Read the task carefully. Use \`Read\`, \`Grep\`, \`Glob\` to understand the relevant code.`,
  )
  lines.push(`2. Make the fix. Edit files directly via \`Edit\` / \`Write\`.`)
  lines.push(
    `3. When the fix is complete, call the \`llui_reply_to_note\` MCP tool with \`replyTo: "${noteId}"\`, a short prose summary, and \`proposedDiff\` containing the unified diff of your changes (use \`git diff\` to obtain it, then pass each modified file's patch in the \`files[]\` array).`,
  )
  lines.push(
    `4. If the task is ambiguous or unsafe, do NOT attempt the fix — instead call \`llui_reply_to_note\` with prose explaining what's unclear or what would be required.`,
  )
  lines.push('')
  lines.push(
    `The status of this note is currently \`claimed\`. After your reply with \`proposedDiff\`, it becomes \`proposed\` and the developer will Accept or Reject.`,
  )
  lines.push('')
  lines.push(
    `If \`llui_reply_to_note\` is unavailable (MCP not configured), as a fallback create a file at \`.llui/notes/${sessionId}/_router-fallback-${noteId}.md\` with your reply markdown plus an embedded unified diff in a fenced \`\`\`diff block — the router will pick it up.`,
  )

  return lines.join('\n')
}

/**
 * Start the attention router. Subscribes to the bus and processes
 * `note-created` events for task-intent notes. Returns a handle that
 * can stop the router and probe state for tests.
 */
export function startRouter(config: RouterConfig): RouterHandle {
  const spawner = config.spawner ?? defaultClaudeSpawner
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = config.log ?? ((msg) => process.stderr.write(`[llui:router] ${msg}\n`))

  const queue: Array<{ sessionId: string; noteId: string }> = []
  let busy = false
  let stopped = false

  const listener: SseEventListener = (event: ServerEvent): void => {
    if (event.type !== 'note-created') return
    // Read the note to check intent. (The 'note-created' event only
    // carries id+filename; we need the full frontmatter.) Skip
    // non-task notes silently.
    let sessionId: string
    try {
      const list = listNotes(config.notesRoot, {})
      const summary = list.notes.find((n) => n.id === event.id)
      if (!summary) return
      sessionId = summary.sessionId
      const note = readNote(config.notesRoot, sessionId, event.id)
      if (note.frontmatter.intent !== 'task') return
    } catch (err) {
      log(`failed to read note ${event.id}: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    queue.push({ sessionId, noteId: event.id })
    void drain()
  }

  const drain = async (): Promise<void> => {
    if (busy || stopped) return
    const next = queue.shift()
    if (!next) return
    busy = true
    try {
      await processTask(next.sessionId, next.noteId)
    } finally {
      busy = false
      if (!stopped) void drain()
    }
  }

  const processTask = async (sessionId: string, noteId: string): Promise<void> => {
    const sessionDir = join(config.notesRoot, sessionId)
    // Skip if already claimed by someone else.
    const cur = currentStatus(sessionDir, noteId)
    if (cur && cur !== 'open') {
      log(`skip ${noteId}: status ${cur}`)
      return
    }

    // Atomic claim. We're single-router-per-server so this is just
    // for the audit trail, but if multiple routers ever coexist the
    // `from` check in status.jsonl is what they'd need to coordinate.
    const claimT: StatusTransition = {
      ts: new Date().toISOString(),
      noteId,
      from: cur,
      to: 'claimed',
      by: 'llm',
      reason: ROUTER_WORKER_ID,
    }
    appendStatus(sessionDir, claimT)
    config.bus.broadcast({
      type: 'status-changed',
      noteId,
      from: cur,
      to: 'claimed',
    })

    const prompt = buildPrompt(sessionId, noteId, config.notesRoot)
    log(`solving ${noteId} (${prompt.length} chars of context)`)

    try {
      // Snapshot history before the spawn so we can detect transitions
      // the LLM made while it was running (those land in status.jsonl
      // via the MCP process — a different process from us — so they
      // never hit our bus). After the spawn we replay the diff.
      const beforeLen = readStatusHistory(sessionDir, noteId).length

      const result = await spawner.spawn({
        prompt,
        cwd: config.projectRoot,
        timeoutMs,
      })

      // After the spawn, the LLM may have already updated status via
      // llui_reply_to_note (→ 'proposed'). Re-read; if it's still
      // 'claimed', treat that as a failure to follow through.
      const fullHistory = readStatusHistory(sessionDir, noteId)
      // Broadcast every transition the LLM wrote while it was running.
      for (const t of fullHistory.slice(beforeLen)) {
        config.bus.broadcast({
          type: 'status-changed',
          noteId,
          from: t.from,
          to: t.to,
        })
      }
      const after = currentStatus(sessionDir, noteId)
      if (after === 'claimed') {
        const reason = result.timedOut
          ? `claude timed out after ${timeoutMs}ms`
          : result.exitCode !== 0
            ? `claude exited ${result.exitCode}${result.stderr ? ': ' + result.stderr.slice(0, 200) : ''}`
            : 'claude finished without filing a reply'
        const failT: StatusTransition = {
          ts: new Date().toISOString(),
          noteId,
          from: 'claimed',
          to: 'failed',
          by: 'system',
          reason,
        }
        appendStatus(sessionDir, failT)
        config.bus.broadcast({
          type: 'status-changed',
          noteId,
          from: 'claimed',
          to: 'failed',
        })
        log(`failed ${noteId}: ${reason}`)
      } else {
        log(`done ${noteId}: status ${after ?? 'unknown'}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failT: StatusTransition = {
        ts: new Date().toISOString(),
        noteId,
        from: 'claimed',
        to: 'failed',
        by: 'system',
        reason: `spawn error: ${message}`,
      }
      appendStatus(sessionDir, failT)
      config.bus.broadcast({
        type: 'status-changed',
        noteId,
        from: 'claimed',
        to: 'failed',
      })
      log(`failed ${noteId}: ${message}`)
    }
  }

  const unsubscribe = config.bus.subscribe('viewer', listener)

  return {
    stop() {
      stopped = true
      unsubscribe()
    },
    queueLength() {
      return queue.length
    },
    isBusy() {
      return busy
    },
  }
}

/** Used by serializeNote re-export in router-related test fixtures. */
export { serializeNote }
