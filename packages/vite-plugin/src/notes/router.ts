// Attention router for task-mode notes (option C of the proposal).
//
// Subscribes to the event bus, claims tasks as they arrive, spawns
// the configured LLM CLI headlessly with a constructed prompt + tool
// access, and observes the resulting status transitions.
//
// The CLI is configurable: a preset (`claude`, `codex`, `gemini`) or
// a fully custom command. Spawners are still injectable so tests don't
// actually shell out — they pass their own `LlmSpawner` to `startRouter`.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'

import type { EventBus, SseEventListener } from './event-bus.js'
import { createNote, listNotes, readNote } from './store.js'
import { appendStatus, currentStatus } from './status.js'
import { serializeNote } from './frontmatter.js'
import type { NoteFrontmatter, ProposedDiff, ServerEvent, StatusTransition } from './types.js'

export interface LlmSpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

export interface LlmSpawner {
  /** Run the configured LLM CLI with the given prompt + cwd. Returns
   *  when the process exits or the timeout fires. */
  spawn(opts: {
    prompt: string
    cwd: string
    timeoutMs: number
    /** Per-task extra args, appended after the preset/config args and
     *  before the prompt (or before stdin is closed for stdin-mode).
     *  Used by the router to inject `--resume <sessionId>` and similar
     *  task-scoped flags. */
    extraArgs?: string[]
  }): Promise<LlmSpawnResult>
}

// Back-compat aliases — tests and external callers may still reference
// the old Claude-specific names.
export type ClaudeSpawnResult = LlmSpawnResult
export type ClaudeSpawner = LlmSpawner

export type LlmPreset = 'claude' | 'codex' | 'gemini'

interface PresetDefinition {
  command: string
  args: string[]
  /** Flag used to pass the model identifier. The value follows as a
   *  separate arg. */
  modelFlag: string
  /** How the prompt reaches the CLI. */
  promptVia: 'arg' | 'stdin'
  /** Model passed when the user doesn't set one explicitly. Tuned for
   *  the typical "fix a small UI bug" use case — fast enough to keep
   *  the dev loop tight, capable enough to handle most diffs. Users
   *  override with `router: { model: 'opus' }`. */
  defaultModel?: string
  /** Flag that resumes a specific prior session by id. The router
   *  appends `[resumeFlag, sessionId]` after the preset args when the
   *  current task has `resume: true` AND a session id was captured
   *  from a previous spawn. Set only on presets that report session
   *  ids back (currently just `claude` with --output-format json). */
  resumeFlag?: string
  /** Shape of the CLI's stdout. `'text'` means raw assistant prose;
   *  `'json'` means a JSON envelope wrapping `result` + `session_id`.
   *  Drives both reply-parsing and session-id capture. */
  outputEnvelope: 'text' | 'json'
}

/**
 * Built-in presets. Each one mirrors the CLI's documented one-shot
 * invocation. `claude` and `codex` accept the prompt as the trailing
 * positional; `gemini` reads it from stdin so we don't blow past
 * shell-style arg length limits with large prompts.
 */
const PRESETS: Record<LlmPreset, PresetDefinition> = {
  claude: {
    command: 'claude',
    // `--output-format json` makes claude emit a single JSON envelope
    // including `session_id` + `result`. The router captures the id
    // from one spawn and feeds it to the next via `--resume`, so a
    // chain of solves shares conversation context deterministically.
    args: ['--print', '--dangerously-skip-permissions', '--output-format', 'json'],
    modelFlag: '--model',
    promptVia: 'arg',
    // Sonnet is the intermediate tier — fast, capable enough for the
    // bulk of dev-loop fixes. Bump to 'opus' for hard refactors via
    // `router: { model: 'opus' }`.
    defaultModel: 'sonnet',
    resumeFlag: '--resume',
    outputEnvelope: 'json',
  },
  codex: {
    command: 'codex',
    args: ['exec', '--full-auto'],
    modelFlag: '--model',
    promptVia: 'arg',
    outputEnvelope: 'text',
  },
  gemini: {
    command: 'gemini',
    args: ['--yolo'],
    modelFlag: '--model',
    promptVia: 'stdin',
    outputEnvelope: 'text',
  },
}

/**
 * Public-facing slice of `RouterConfig` — the fields a user can set
 * via `devmodeAnnotate.router`. The plugin layers in `notesRoot`,
 * `projectRoot`, `bus`, `log` etc. before calling `startRouter`.
 */
export type LlmRouterConfig = Pick<
  RouterConfig,
  | 'preset'
  | 'command'
  | 'args'
  | 'model'
  | 'extraArgs'
  | 'env'
  | 'promptVia'
  | 'timeoutMs'
  | 'concurrency'
  | 'contextFiles'
>

/**
 * Resolved router config — what `startRouter` ultimately consumes.
 * Either `spawner` is injected (tests / dependency inversion) OR
 * the preset/custom fields drive a real child_process.
 */
export interface RouterConfig {
  /** Path of the .llui/notes/ root. */
  notesRoot: string
  /** Working directory passed to the spawned CLI — the project root.
   *  The CLI inherits the project's `CLAUDE.md`, `.mcp.json`, etc. */
  projectRoot: string
  /** Event bus to subscribe to. */
  bus: EventBus
  /** Spawner override. When omitted, a default spawner is built from
   *  `preset` / `command` etc. */
  spawner?: LlmSpawner
  /** CLI preset. Default `'claude'`. Ignored when `spawner` is set. */
  preset?: LlmPreset
  /** Override the binary name (mostly useful for `'custom'` setups
   *  where there's no matching preset). Ignored when `spawner` is set. */
  command?: string
  /** Static args prepended before model + extraArgs + prompt. When
   *  unset and `preset` is given, the preset's args are used. */
  args?: string[]
  /** Model identifier (e.g. `'opus'`, `'gpt-5'`, `'gemini-2.5-pro'`).
   *  Mapped to the preset's modelFlag. */
  model?: string
  /** Extra args appended after preset args + model, before the prompt.
   *  Escape hatch for per-tool flags we haven't promoted. */
  extraArgs?: string[]
  /** Extra env vars merged with `process.env`. */
  env?: Record<string, string>
  /** How the prompt reaches the CLI. Defaults per preset. */
  promptVia?: 'arg' | 'stdin'
  /** Per-task timeout in ms. Default 5 minutes. */
  timeoutMs?: number
  /** Number of tasks that may run concurrently. Default 1
   *  (serialized — avoids competing patches against the same files). */
  concurrency?: number
  /**
   * Project-relative paths to additional context files that get
   * inlined into every prompt the router sends, between the task body
   * and the reply-format instructions. Use this to surface project-
   * specific conventions, design notes, or scratch files the LLM
   * wouldn't otherwise see.
   *
   * Note: `claude --print` already auto-loads `CLAUDE.md` from the
   * project root (and nested CLAUDE.md per claude code's normal
   * resolution rules), so don't add it here. This config is for the
   * "ALSO show the model these files" case — e.g. a design doc, a
   * dependency-policy file, an API surface manifest. Files that don't
   * exist are skipped with a one-line warning.
   */
  contextFiles?: string[]
  /** Logger; defaults to stderr. */
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

export interface ResolvedCliInvocation {
  command: string
  args: string[]
  promptVia: 'arg' | 'stdin'
  env: NodeJS.ProcessEnv
}

/**
 * Materialize a CLI invocation from a router config. Layers the chosen
 * preset's defaults, the explicit overrides, the model flag, and any
 * `extraArgs`. The prompt itself is appended later (or piped via stdin)
 * depending on `promptVia`.
 */
export function resolveCliInvocation(config: RouterConfig): ResolvedCliInvocation {
  // When the user passes `command` without `preset`, treat it as a
  // fully custom invocation — don't layer in any preset's defaults
  // (default model, default args, default promptVia). They opted out
  // of the preset by giving us a binary.
  const explicitlyCustom = config.command !== undefined && config.preset === undefined
  const preset: LlmPreset | undefined = explicitlyCustom ? undefined : (config.preset ?? 'claude')
  const def = preset ? PRESETS[preset] : undefined
  const command = config.command ?? def?.command
  if (!command) {
    throw new Error('[llui:router] router config must specify a `preset` or a `command`')
  }
  const baseArgs = config.args ?? def?.args ?? []
  const effectiveModel = config.model ?? def?.defaultModel
  const modelArgs = effectiveModel
    ? def
      ? [def.modelFlag, effectiveModel]
      : ['--model', effectiveModel]
    : []
  const extraArgs = config.extraArgs ?? []
  return {
    command,
    args: [...baseArgs, ...modelArgs, ...extraArgs],
    promptVia: config.promptVia ?? def?.promptVia ?? 'arg',
    env: { ...process.env, ...(config.env ?? {}) },
  }
}

/**
 * Build a spawner from a router config. The returned object satisfies
 * `LlmSpawner` so the rest of the router doesn't care which CLI is
 * underneath. Kills the child on timeout and reports `timedOut: true`.
 */
export function createCliSpawner(config: RouterConfig): LlmSpawner {
  const invocation = resolveCliInvocation(config)
  return {
    async spawn({ prompt, cwd, timeoutMs, extraArgs }) {
      return new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        let timedOut = false
        // Final arg list:
        //   [...preset/config args, ...task-scoped extraArgs, prompt?]
        // The prompt is appended when promptVia='arg'; otherwise it's
        // piped via stdin below.
        const finalArgs = [...invocation.args, ...(extraArgs ?? [])]
        const argsWithPrompt = invocation.promptVia === 'arg' ? [...finalArgs, prompt] : finalArgs
        const child: ChildProcess = spawn(invocation.command, argsWithPrompt, {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: invocation.env,
        })
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
        if (invocation.promptVia === 'stdin') {
          child.stdin?.end(prompt + '\n', 'utf8')
        } else {
          // Prompt is in argv; still close stdin so the child knows
          // there's nothing more coming.
          child.stdin?.end()
        }
      })
    },
  }
}

/**
 * Back-compat: a spawner pre-bound to the `'claude'` preset. Kept for
 * existing call sites; new code should prefer `createCliSpawner` so
 * preset, model, env etc. propagate consistently.
 */
export const defaultClaudeSpawner: LlmSpawner = createCliSpawner({
  notesRoot: '',
  projectRoot: '',
  bus: { broadcast: () => {}, subscribe: () => () => {} } as unknown as EventBus,
  preset: 'claude',
})

/**
 * Probe whether the given CLI binary is on PATH. We don't care about
 * the version — only that the binary exists. If not, the router still
 * starts (no spawns happen) and the plugin reports the missing binary
 * one-shot, so installed-or-not is a graceful downgrade.
 */
export function isCliAvailable(command: string): boolean {
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    if (existsSync(join(dir, command))) return true
  }
  return false
}

/** Back-compat — prefer `isCliAvailable('claude')`. */
export function isClaudeAvailable(): boolean {
  return isCliAvailable('claude')
}

const ROUTER_WORKER_ID = 'llui-router'

/**
 * Build the prompt fed to claude. Mirrors what an interactive Claude
 * would see if a developer dropped the note into chat manually:
 * frontmatter context, prose, plus an instruction to file a reply.
 */
interface BuildPromptOpts {
  /** Absolute paths to inline as additional context. Pre-resolved by
   *  the caller so this fn doesn't need projectRoot. */
  contextFiles?: string[]
  log?: (msg: string) => void
}

function buildPrompt(
  sessionId: string,
  noteId: string,
  notesRoot: string,
  opts: BuildPromptOpts = {},
): string {
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

  // Project-configured extra context files. Path + contents fenced
  // inside a markdown block so the LLM can tell where each chunk
  // came from. Missing files are warned about, not fatal — a
  // misconfigured contextFiles list shouldn't sink the whole solve.
  if (opts.contextFiles && opts.contextFiles.length > 0) {
    lines.push('### Additional project context')
    lines.push('')
    for (const absPath of opts.contextFiles) {
      if (!existsSync(absPath)) {
        opts.log?.(`contextFiles: '${absPath}' not found — skipping`)
        continue
      }
      try {
        const contents = readFileSync(absPath, 'utf8')
        lines.push(`#### \`${absPath}\``)
        lines.push('')
        lines.push('```')
        lines.push(contents)
        lines.push('```')
        lines.push('')
      } catch (err) {
        opts.log?.(
          `contextFiles: failed to read '${absPath}': ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
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

/**
 * Output of the JSON-envelope CLIs (currently just claude). Other
 * fields exist but the router only cares about these two.
 */
export interface CliJsonEnvelope {
  /** The assistant's final text response. */
  result: string
  /** Session identifier the CLI assigned. Pass back via `--resume` to
   *  continue this conversation. */
  session_id?: string
}

/**
 * Best-effort envelope parse. Claude in `--output-format json` mode
 * emits one JSON object to stdout. If we can't parse it, we fall back
 * to treating the whole stdout as the assistant text so existing
 * llui-reply extraction still has a shot.
 */
export function parseCliJsonEnvelope(stdout: string): CliJsonEnvelope | null {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const result = typeof parsed['result'] === 'string' ? (parsed['result'] as string) : null
    if (result === null) return null
    const out: CliJsonEnvelope = { result }
    if (typeof parsed['session_id'] === 'string') {
      out.session_id = parsed['session_id'] as string
    }
    return out
  } catch {
    return null
  }
}

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
  const spawner = config.spawner ?? createCliSpawner(config)
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const concurrency = Math.max(1, config.concurrency ?? 1)
  const log = config.log ?? ((msg) => process.stderr.write(`[llui:router] ${msg}\n`))
  // The CLI name only surfaces in error/log messages — we don't fail
  // the build if the user passes a custom spawner without a command.
  const cliName = config.command ?? PRESETS[config.preset ?? 'claude']?.command ?? 'llm'

  const queue: Array<{ sessionId: string; noteId: string }> = []
  let activeCount = 0
  let stopped = false
  // Session id captured from the most recent CLI spawn. When the next
  // task's frontmatter has `resume: true`, the router passes
  // `[preset.resumeFlag, lastSessionId]` so the LLM continues that
  // conversation. Null until the first successful spawn.
  let lastSessionId: string | null = null
  const presetDef = config.spawner ? null : PRESETS[config.preset ?? 'claude']
  const outputEnvelope: 'text' | 'json' = presetDef?.outputEnvelope ?? 'text'

  // Resolve context-file paths against projectRoot upfront so the
  // prompt builder doesn't need to know about the root layout. Paths
  // that don't exist are logged in buildPrompt and skipped at render.
  const resolvedContextFiles: string[] = (config.contextFiles ?? []).map((p) =>
    resolvePath(config.projectRoot, p),
  )

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

  const drain = (): void => {
    if (stopped) return
    while (activeCount < concurrency && queue.length > 0) {
      const next = queue.shift()!
      activeCount++
      void (async () => {
        try {
          await processTask(next.sessionId, next.noteId)
        } finally {
          activeCount--
          if (!stopped) drain()
        }
      })()
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

    const prompt = buildPrompt(sessionId, noteId, config.notesRoot, {
      ...(resolvedContextFiles.length > 0 ? { contextFiles: resolvedContextFiles } : {}),
      log,
    })
    log(`solving ${noteId} (${prompt.length} chars of context)`)

    // Build per-task extra args. Resume only kicks in when:
    //   - the note's frontmatter explicitly asks (resume: true)
    //   - the active preset has a resume flag
    //   - we've already captured at least one session id
    // First-ever task in a router lifetime never resumes (nothing to
    // resume to). When the user has concurrency > 1 and another spawn
    // is in flight, we warn — multiple resumes against the same
    // baseline can chain unpredictably.
    const note = readNote(config.notesRoot, sessionId, noteId)
    const wantsResume = note.frontmatter.resume === true
    const extraArgs: string[] = []
    if (wantsResume && presetDef?.resumeFlag && lastSessionId) {
      extraArgs.push(presetDef.resumeFlag, lastSessionId)
      if (activeCount > 1) {
        log(
          `warning: resume requested for ${noteId} while ${activeCount - 1} other task(s) are in flight; ` +
            `chains may interleave (set concurrency: 1 for deterministic resume)`,
        )
      }
    }

    try {
      const result = await spawner.spawn({
        prompt,
        cwd: config.projectRoot,
        timeoutMs,
        ...(extraArgs.length > 0 ? { extraArgs } : {}),
      })

      // Quick fails before parsing — these don't get a reply note.
      if (result.timedOut) {
        return fail(`${cliName} timed out after ${timeoutMs}ms`)
      }
      if (result.exitCode !== 0) {
        const tail = result.stderr ? `: ${result.stderr.slice(0, 200)}` : ''
        return fail(`${cliName} exited ${result.exitCode}${tail}`)
      }

      // Unwrap the JSON envelope when the preset uses one. We capture
      // session_id for future resumes AND extract the assistant text
      // to feed into the existing reply parser. For text-mode presets
      // the stdout IS the assistant text and there's no session id to
      // capture.
      let assistantText = result.stdout
      if (outputEnvelope === 'json') {
        const envelope = parseCliJsonEnvelope(result.stdout)
        if (envelope) {
          assistantText = envelope.result
          if (envelope.session_id) {
            lastSessionId = envelope.session_id
          }
        } else {
          // Couldn't parse — fall back to raw stdout so the reply
          // extractor still has a chance. The session-id chain breaks
          // for this hop; next task starts fresh.
          log(`warning: ${cliName} did not emit a parseable JSON envelope; resume chain reset`)
        }
      }

      // Parse the structured llui-reply block from the assistant text.
      // This is the canonical exchange — no MCP needed.
      const parsed = parseLluiReply(assistantText)
      if (!parsed.ok) {
        return fail(parsed.error)
      }

      // Write the reply note + proposedDiff ourselves. The LLM's
      // stdout reasoning above the reply block is preserved as the
      // reply note's prose so the dev can read what claude thought.
      const proseOnly = assistantText.replace(REPLY_BLOCK_RE, '').trim()
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
      return activeCount > 0
    },
  }
}

/** Used by serializeNote re-export in router-related test fixtures. */
export { serializeNote }
