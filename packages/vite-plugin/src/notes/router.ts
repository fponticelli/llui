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
import { createNote, listNotes, readNote } from './store.js'
import { appendStatus, currentStatus } from './status.js'
import { serializeNote } from './frontmatter.js'
import type { NoteFrontmatter, ProposedDiff, ServerEvent, StatusTransition } from './types.js'

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
    '1. Read the task carefully. Use `Read`, `Grep`, `Glob` to understand the relevant code.',
  )
  lines.push(
    '2. **Do NOT edit any files.** Plan the fix mentally and construct the unified diff yourself. The developer will Accept or Reject before any change lands.',
  )
  lines.push(
    '3. End your response with EXACTLY one fenced `llui-reply` block (described below). The router parses this block out of your stdout — nothing else is read.',
  )
  lines.push('')
  lines.push('### Reply format — required')
  lines.push('')
  lines.push(
    'Output a single fenced ```` ```llui-reply ```` block containing JSON with this shape:',
  )
  lines.push('')
  lines.push('````')
  lines.push('```llui-reply')
  lines.push('{')
  lines.push('  "summary": "one-line description of the proposed change",')
  lines.push('  "confidence": "high" | "medium" | "low",')
  lines.push('  "files": [')
  lines.push('    { "path": "relative/from/repo/root.ts", "patch": "unified diff text" }')
  lines.push('  ]')
  lines.push('}')
  lines.push('```')
  lines.push('````')
  lines.push('')
  lines.push(
    `Each \`patch\` MUST be a valid unified diff (the kind \`git apply\` accepts) for a single file, with \`--- a/<path>\` and \`+++ b/<path>\` headers. Empty \`files\` means "no fix proposed" — use it with a \`summary\` explaining why (ambiguous, unsafe, needs more info, etc.) and \`confidence: "low"\`.`,
  )
  lines.push('')
  lines.push(
    `Status is currently \`claimed\`. After the router parses your reply, it appends \`proposed\` and the developer Accepts/Rejects. Apply happens via \`git apply\` on Accept.`,
  )

  return lines.join('\n')
}

/**
 * Parse the `llui-reply` JSON block claude emits at the end of its
 * stdout. Forgiving: takes the LAST occurrence (in case claude
 * narrates partial drafts mid-response), validates the shape, returns
 * a typed payload or a parse error.
 */
export interface ParsedReply {
  summary: string
  confidence: 'high' | 'medium' | 'low'
  files: Array<{ path: string; patch: string }>
}

export type ParseReplyResult = { ok: true; reply: ParsedReply } | { ok: false; error: string }

const REPLY_BLOCK_RE = /```llui-reply\s*\n([\s\S]*?)\n```/g

export function parseLluiReply(stdout: string): ParseReplyResult {
  const matches = [...stdout.matchAll(REPLY_BLOCK_RE)]
  if (matches.length === 0) {
    return { ok: false, error: 'no `llui-reply` block found in output' }
  }
  const last = matches[matches.length - 1]!
  let parsed: unknown
  try {
    parsed = JSON.parse(last[1]!)
  } catch (err) {
    return {
      ok: false,
      error: `llui-reply JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'llui-reply payload is not an object' }
  }
  const p = parsed as Record<string, unknown>
  if (typeof p['summary'] !== 'string' || p['summary'].length === 0) {
    return { ok: false, error: 'missing/empty `summary` in llui-reply' }
  }
  const conf = p['confidence']
  if (conf !== 'high' && conf !== 'medium' && conf !== 'low') {
    return { ok: false, error: '`confidence` must be high|medium|low' }
  }
  if (!Array.isArray(p['files'])) {
    return { ok: false, error: '`files` must be an array' }
  }
  const files: Array<{ path: string; patch: string }> = []
  for (const f of p['files'] as unknown[]) {
    if (typeof f !== 'object' || f === null) {
      return { ok: false, error: 'each `files[]` entry must be an object' }
    }
    const fp = f as Record<string, unknown>
    if (typeof fp['path'] !== 'string' || typeof fp['patch'] !== 'string') {
      return { ok: false, error: '`files[].path` and `.patch` must be strings' }
    }
    files.push({ path: fp['path'], patch: fp['patch'] })
  }
  return {
    ok: true,
    reply: {
      summary: p['summary'],
      confidence: conf,
      files,
    },
  }
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
      const result = await spawner.spawn({
        prompt,
        cwd: config.projectRoot,
        timeoutMs,
      })

      // Quick fails before parsing — these don't get a reply note.
      if (result.timedOut) {
        return fail(`claude timed out after ${timeoutMs}ms`)
      }
      if (result.exitCode !== 0) {
        const tail = result.stderr ? `: ${result.stderr.slice(0, 200)}` : ''
        return fail(`claude exited ${result.exitCode}${tail}`)
      }

      // Parse the structured llui-reply block from stdout. This is the
      // canonical exchange — no MCP needed.
      const parsed = parseLluiReply(result.stdout)
      if (!parsed.ok) {
        return fail(parsed.error)
      }

      // Write the reply note + proposedDiff ourselves. The LLM's
      // stdout reasoning above the reply block is preserved as the
      // reply note's prose so the dev can read what claude thought.
      const proseOnly = result.stdout.replace(REPLY_BLOCK_RE, '').trim()
      const proposedDiff: ProposedDiff = {
        files: parsed.reply.files,
        summary: parsed.reply.summary,
        confidence: parsed.reply.confidence,
      }
      const replyFm: Omit<NoteFrontmatter, 'id' | 'ts'> = {
        author: 'llm',
        kind: 'reply',
        captureLevel: 'standard',
        url: '',
        route: null,
        routeParams: {},
        viewport: { w: 0, h: 0, dpr: 1 },
        componentPath: null,
        componentMeta: null,
        annotations: [],
        screenshot: null,
        agentSchemas: [],
        llui: { runtime: 'unknown', compiler: 'unknown' },
        intent: 'note',
        replyTo: noteId,
        proposedDiff,
      }
      const replyResult = createNote(config.notesRoot, {
        body: proseOnly || `_(no narrative — see proposedDiff)_`,
        frontmatter: replyFm,
        noteBody: {},
      })
      // Append 'proposed' and broadcast — the router owns this
      // transition since the MCP path isn't involved.
      const proposedT: StatusTransition = {
        ts: new Date().toISOString(),
        noteId,
        from: 'claimed',
        to: 'proposed',
        by: 'llm',
        reason: `reply ${replyResult.id}: ${parsed.reply.summary}`,
      }
      appendStatus(sessionDir, proposedT)
      config.bus.broadcast({
        type: 'status-changed',
        noteId,
        from: 'claimed',
        to: 'proposed',
        reason: parsed.reply.summary,
      })
      log(
        `proposed ${noteId} → ${replyResult.id} (${parsed.reply.files.length} file${
          parsed.reply.files.length === 1 ? '' : 's'
        }, ${parsed.reply.confidence})`,
      )
      return

      function fail(reason: string): void {
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
          reason,
        })
        log(`failed ${noteId}: ${reason}`)
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
