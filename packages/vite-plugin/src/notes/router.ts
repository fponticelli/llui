// Attention router for task-mode notes (option C of the proposal).
//
// Subscribes to the event bus, claims tasks as they arrive, spawns
// the configured LLM CLI headlessly with a constructed prompt + tool
// access, and observes the resulting status transitions.
//
// The CLI is configurable: a preset (`claude`, `codex`, `gemini`) or
// a fully custom command. Spawners are still injectable so tests don't
// actually shell out — they pass their own `LlmSpawner` to `startRouter`.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'

import type { EventBus, SseEventListener } from './event-bus.js'
import type { TrustedTaskRegistry } from './trusted-tasks.js'
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
    /** Per-line callback fired as stdout streams in. Each call gets
     *  one fully-terminated line (no trailing newline). The router
     *  uses this to drive live progress events when the preset emits
     *  newline-delimited JSON (e.g. claude `--output-format stream-json`). */
    onStdoutLine?: (line: string) => void
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
  /** Shape of the CLI's stdout.
   *   - `'text'`: raw assistant prose; no session id available.
   *   - `'json'`: single JSON envelope at end with `result` + `session_id`.
   *   - `'stream-json'`: newline-delimited JSON messages (one per
   *     event: system init, assistant turns, tool calls/results, final
   *     result). Enables live progress events. */
  outputEnvelope: 'text' | 'json' | 'stream-json'
  /** Flag that disables the CLI's interactive permission prompts, running
   *  it fully unattended (e.g. claude's `--dangerously-skip-permissions`).
   *  This is NEVER in the default `args` — it is appended ONLY when the
   *  user explicitly opts in via `dangerouslySkipPermissions: true`, because
   *  it grants the spawned agent unattended tool access (file writes, shell)
   *  in the project root. Presets without such a flag leave this undefined. */
  skipPermissionsFlag?: string
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
    // `--output-format stream-json` (+ `--verbose`, required by
    // claude in print-mode for stream-json) emits one JSON object per
    // line as claude works: system init, assistant turns, tool
    // calls, tool results, and a final `result` message carrying
    // `session_id` + total `usage`. The router parses these live and
    // pushes `task-progress` SSE events to the HUD so the user sees
    // tokens / last tool / elapsed time instead of an opaque spinner.
    // NOTE: `--dangerously-skip-permissions` is intentionally NOT in the
    // default args. It runs the agent fully unattended with tool access
    // (file writes + shell) in the project root, so it is opt-in only via
    // `dangerouslySkipPermissions: true` (see `skipPermissionsFlag`).
    args: ['--print', '--verbose', '--output-format', 'stream-json'],
    modelFlag: '--model',
    promptVia: 'arg',
    // Sonnet is the intermediate tier — fast, capable enough for the
    // bulk of dev-loop fixes. Bump to 'opus' for hard refactors via
    // `router: { model: 'opus' }`.
    defaultModel: 'sonnet',
    resumeFlag: '--resume',
    outputEnvelope: 'stream-json',
    skipPermissionsFlag: '--dangerously-skip-permissions',
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
 * Returns the preset definition only if it emits stream-json (i.e. is
 * a candidate for the streaming → json downgrade). Used by startRouter
 * to decide whether `streaming: false` actually needs to rewrite args.
 */
function presetDefForDowngrade(config: RouterConfig): PresetDefinition | null {
  if (config.spawner) return null
  const def = PRESETS[config.preset ?? 'claude']
  return def?.outputEnvelope === 'stream-json' ? def : null
}

/**
 * Rewrite a router config so the CLI emits a single JSON envelope
 * instead of stream-json: replace the format token + strip --verbose.
 * Other config fields pass through. Caller has already checked that
 * the active preset is a stream-json one.
 */
function downgradeStreamingToJson(config: RouterConfig): RouterConfig {
  const def = PRESETS[config.preset ?? 'claude']
  const baseArgs = config.args ?? def?.args ?? []
  const args = baseArgs
    .filter((a) => a !== '--verbose')
    .map((a) => (a === 'stream-json' ? 'json' : a))
  return { ...config, args }
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
  | 'beforePrompt'
  | 'streaming'
  | 'dangerouslySkipPermissions'
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
  /**
   * DANGEROUS, opt-in only. When `true`, append the active preset's
   * skip-permissions flag (e.g. claude's `--dangerously-skip-permissions`)
   * so the spawned agent runs fully unattended — no interactive approval
   * for file writes or shell commands in the project root. Off by default;
   * only enable when you understand that a task note can then drive
   * arbitrary local tool use without a human in the loop. Ignored for
   * presets/commands that expose no such flag.
   */
  dangerouslySkipPermissions?: boolean
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
  /**
   * Live progress events during solve. When `true` (default), the
   * router parses claude's `--output-format stream-json` output as
   * lines arrive and broadcasts `task-progress` SSE events with
   * elapsed time, running token counts, and the last tool used. The
   * HUD surfaces this as a live status line so the user knows the
   * solve is working instead of stuck.
   *
   * Set `false` to fall back to the single-envelope `json` format —
   * less chatty on the wire but no in-flight feedback. Other presets
   * (codex, gemini) fall back to an elapsed-time-only heartbeat
   * regardless of this setting.
   */
  streaming?: boolean
  /**
   * Transform the prompt right before it's sent to the LLM. Runs
   * after `buildPrompt()` (which assembles the note + contextFiles)
   * and after any preset-specific layering. Use this to:
   *   - prepend a project-specific persona / policy block,
   *   - sanitize PII / secrets out of the prompt,
   *   - inject computed context (recent commits, open PRs, …) that
   *     contextFiles can't express because it's dynamic.
   * Receives the assembled prompt + the note being solved; returns
   * the prompt to actually send. May return a Promise.
   */
  beforePrompt?: (input: { prompt: string; note: NoteContext }) => string | Promise<string>
  /** Logger; defaults to stderr. */
  log?: (msg: string) => void
  /**
   * Provenance registry gating which task notes may spawn an agent. When
   * set, a `note-created` event only triggers a spawn if the note was
   * marked trusted (i.e. created through the authenticated same-origin
   * middleware). This prevents a note that reached disk by some other
   * path — a forged/dropped file, a stale mutation — from auto-spawning a
   * CLI agent in the project root. When omitted, the router falls back to
   * the on-disk `intent` field alone (dev/test convenience only).
   */
  trustedTasks?: TrustedTaskRegistry
}

/**
 * Read-only view of the note exposed to `beforePrompt`. We pass the
 * frontmatter + prose explicitly so the hook doesn't need to touch
 * the filesystem or import store internals.
 */
export interface NoteContext {
  sessionId: string
  noteId: string
  frontmatter: NoteFrontmatter
  prose: string
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
  // Skip-permissions is opt-in and preset-specific: only append the flag
  // when the user explicitly asked AND the active preset exposes one.
  const skipPermArgs =
    config.dangerouslySkipPermissions && def?.skipPermissionsFlag ? [def.skipPermissionsFlag] : []
  return {
    command,
    args: [...baseArgs, ...skipPermArgs, ...modelArgs, ...extraArgs],
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
    async spawn({ prompt, cwd, timeoutMs, extraArgs, onStdoutLine }) {
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
        // Line buffer for onStdoutLine. We still accumulate full
        // `stdout` so the existing single-shot JSON-envelope path
        // keeps working unchanged when no callback is supplied.
        let lineBuffer = ''
        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          stdout += text
          if (!onStdoutLine) return
          lineBuffer += text
          let nlIdx = lineBuffer.indexOf('\n')
          while (nlIdx !== -1) {
            const line = lineBuffer.slice(0, nlIdx)
            lineBuffer = lineBuffer.slice(nlIdx + 1)
            if (line.length > 0) onStdoutLine(line)
            nlIdx = lineBuffer.indexOf('\n')
          }
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
    '2. **Apply the fix directly** — use `Edit`, `Write`, `MultiEdit`, and any other tools you need. ' +
      'The router will diff your changes against the pre-spawn state and present them to the developer for Accept/Reject.',
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
  lines.push('  "summary": "one-line description of the change you made",')
  lines.push('  "confidence": "high" | "medium" | "low",')
  lines.push('  "files": [')
  lines.push('    { "path": "relative/from/repo/root.ts" }')
  lines.push('  ]')
  lines.push('}')
  lines.push('```')
  lines.push('````')
  lines.push('')
  lines.push(
    `\`files[]\` lists the paths you touched (router uses this as a hint; the actual diff is captured from git). Empty \`files\` means "no fix applied" — use it with a \`summary\` explaining why (ambiguous, unsafe, needs more info, etc.) and \`confidence: "low"\`. **Do not include a \`patch\` field; the router constructs the diff itself.**`,
  )
  lines.push('')
  lines.push(
    `Status is currently \`claimed\`. After you finish editing, the router captures \`git diff\` against the pre-spawn snapshot, attaches it to a reply note, and transitions to \`proposed\`. The developer Accepts (no-op; changes stay in the working tree) or Rejects (router reverts via \`git checkout HEAD -- <file>\` for tracked changes + \`rm\` for newly-created files).`,
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
  /** Paths the LLM claims to have touched. Used as a HINT — the
   *  router computes the actual diff from git. Patches the LLM
   *  includes (legacy schema) are ignored. */
  files: string[]
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
 * One incremental update derived from a single stream-json line.
 * The router accumulates these into a progress state and broadcasts
 * coalesced events.
 */
export interface StreamJsonUpdate {
  /** Captured on the first system-init message (and re-asserted by
   *  the final result). Used to drive the resume chain. */
  sessionId?: string
  /** Short human-readable summary of the most recent tool call —
   *  e.g. "reading App.tsx", "editing payment.ts", "running bash".
   *  Surfaced in the HUD's live status line. */
  toolSummary?: string
  /** Raw usage shape from THIS specific line — semantics depend on
   *  `messageType`. The router uses these + the type to maintain
   *  monotonic running totals; consumers shouldn't display them
   *  directly. */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadInputTokens?: number
  }
  /** Which stream-json message produced this update. Used by the
   *  router's accumulator: assistant.output_tokens is per-turn (sum
   *  it); result.output_tokens is the cumulative total (assign,
   *  don't add). input_tokens grows monotonically across turns so
   *  the latest value is the current context size. */
  messageType?: 'system' | 'assistant' | 'user' | 'result'
  /** The full assistant text from the final `result` message. Only
   *  set on the terminal line. */
  finalText?: string
}

/**
 * Parse a single line of claude's `--output-format stream-json` output
 * and extract just the parts the router cares about. Returns null for
 * lines we don't recognize (heartbeats, malformed JSON, etc).
 */
export function parseStreamJsonLine(line: string): StreamJsonUpdate | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  const out: StreamJsonUpdate = {}
  const type = parsed['type']
  if (type === 'system' || type === 'assistant' || type === 'user' || type === 'result') {
    out.messageType = type
  }
  if (typeof parsed['session_id'] === 'string') {
    out.sessionId = parsed['session_id'] as string
  }
  // Per-message usage: claude attaches `usage` to assistant turns
  // and a cumulative `usage` to the final result. We just forward
  // the raw fields; the router decides how to aggregate based on
  // `messageType`.
  const usage = (parsed['usage'] as Record<string, unknown> | undefined) ?? null
  const msgUsage = ((parsed['message'] as Record<string, unknown> | undefined)?.['usage'] ??
    null) as Record<string, unknown> | null
  const u = usage ?? msgUsage
  if (u) {
    const collected: NonNullable<StreamJsonUpdate['usage']> = {}
    if (typeof u['input_tokens'] === 'number') collected.inputTokens = u['input_tokens'] as number
    if (typeof u['output_tokens'] === 'number')
      collected.outputTokens = u['output_tokens'] as number
    if (typeof u['cache_read_input_tokens'] === 'number') {
      collected.cacheReadInputTokens = u['cache_read_input_tokens'] as number
    }
    if (Object.keys(collected).length > 0) out.usage = collected
  }
  // Tool calls: assistant messages may include tool_use content
  // blocks. We surface the most recent.
  if (type === 'assistant') {
    const msg = parsed['message'] as { content?: unknown } | undefined
    const content = Array.isArray(msg?.content) ? (msg!.content as unknown[]) : []
    for (let i = content.length - 1; i >= 0; i--) {
      const block = content[i] as Record<string, unknown>
      if (block?.['type'] === 'tool_use') {
        out.toolSummary = summarizeToolUse(block)
        break
      }
    }
  }
  if (type === 'result') {
    if (typeof parsed['result'] === 'string') {
      out.finalText = parsed['result'] as string
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Turn a `tool_use` content block from stream-json into a short
 * present-tense phrase for the HUD's live status line. Truncates
 * long arg values so the line stays compact.
 */
function summarizeToolUse(block: Record<string, unknown>): string {
  const name = typeof block['name'] === 'string' ? (block['name'] as string) : 'tool'
  const input = (block['input'] as Record<string, unknown> | undefined) ?? {}
  const verbByName: Record<string, string> = {
    Read: 'reading',
    Edit: 'editing',
    Write: 'writing',
    Bash: 'running',
    Grep: 'searching',
    Glob: 'globbing',
    Task: 'spawning agent',
  }
  const verb = verbByName[name] ?? name.toLowerCase()
  // Best-effort arg extraction. Path-like fields win; otherwise fall
  // back to a short stringification.
  const fileArg =
    (input['file_path'] as string | undefined) ??
    (input['path'] as string | undefined) ??
    (input['pattern'] as string | undefined)
  if (fileArg) {
    const short = fileArg.length > 32 ? `…${fileArg.slice(-32)}` : fileArg
    return `${verb} ${short}`
  }
  const cmd = input['command'] as string | undefined
  if (cmd) {
    const head = cmd.split(/\s+/)[0] ?? ''
    return `${verb} ${head}`
  }
  return verb
}

// ── Git baseline + diff capture ───────────────────────────────────
// The router used to ask the LLM to produce a unified diff and feed
// it to `git apply`. That was fragile (LLM-constructed diffs often
// fail to apply cleanly) so we flipped the model: the LLM edits files
// directly, and the router computes the proposed diff from git.

/**
 * Snapshot of the working tree state before the LLM runs. Used to
 * distinguish "claude touched this file" from "the user had a
 * pre-existing modification we should leave alone". We track both
 * tracked-but-modified files and untracked files so creations are
 * detected too.
 */
/**
 * Read the persisted chain → sessionId map written by an earlier
 * router lifetime. Returns an empty Map if the file is missing or
 * unparseable — chain history just starts fresh in that case.
 */
function loadChainState(path: string): Map<string, string> {
  const out = new Map<string, string>()
  try {
    if (!existsSync(path)) return out
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out.set(k, v)
      }
    }
  } catch {
    // Corrupt file → ignore. Next persist will overwrite.
  }
  return out
}

export interface GitBaseline {
  /** Working-tree-modified tracked files at baseline (porcelain "M ",
   *  " M", "MM", "AM", etc.). The pre-existing dirt. */
  preDirty: Set<string>
  /** Untracked-but-present files at baseline (porcelain "??"). */
  preUntracked: Set<string>
}

const EMPTY_BASELINE: GitBaseline = {
  preDirty: new Set(),
  preUntracked: new Set(),
}

export function captureGitBaseline(projectRoot: string): GitBaseline {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const baseline: GitBaseline = { preDirty: new Set(), preUntracked: new Set() }
    for (const entry of out.split('\0')) {
      if (entry.length < 3) continue
      const code = entry.slice(0, 2)
      const path = entry.slice(3)
      if (code === '??') baseline.preUntracked.add(path)
      else baseline.preDirty.add(path)
    }
    return baseline
  } catch {
    // No git, or run outside a repo — treat everything as untracked-
    // before so a Reject won't try to revert anything.
    return EMPTY_BASELINE
  }
}

/**
 * Compute the per-file unified diffs claude produced. Compares the
 * current working tree to HEAD for files that became dirty during
 * the spawn, and synthesizes add-file patches for files that became
 * untracked during the spawn. Files already dirty before the spawn
 * are skipped (we can't separate the user's prior edits from
 * claude's). Returns the shape proposedDiff expects.
 */
export function computeGitDiffSinceBaseline(
  projectRoot: string,
  baseline: GitBaseline,
  log: (msg: string) => void,
): Array<{ path: string; patch: string }> {
  let post: GitBaseline
  try {
    post = captureGitBaseline(projectRoot)
  } catch {
    return []
  }
  const newlyDirty: string[] = []
  const newlyUntracked: string[] = []
  for (const path of post.preDirty) {
    if (!baseline.preDirty.has(path)) newlyDirty.push(path)
  }
  for (const path of post.preUntracked) {
    if (!baseline.preUntracked.has(path)) newlyUntracked.push(path)
  }
  if (baseline.preDirty.size > 0 && newlyDirty.some((p) => baseline.preDirty.has(p))) {
    log(
      'warning: some files claude edited had pre-existing modifications — Reject will skip those (manual revert required)',
    )
  }

  const files: Array<{ path: string; patch: string }> = []
  for (const path of newlyDirty) {
    try {
      const patch = execFileSync('git', ['diff', 'HEAD', '--no-color', '--', path], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
      })
      if (patch.trim().length > 0) files.push({ path, patch })
    } catch (err) {
      log(`git diff failed for ${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const path of newlyUntracked) {
    try {
      const content = readFileSync(join(projectRoot, path), 'utf8')
      files.push({ path, patch: synthesizeAddFilePatch(path, content) })
    } catch {
      // Binary, unreadable, or removed before we got here — skip.
    }
  }
  return files
}

/**
 * Build a unified-diff representation of an entirely new file. Mirrors
 * the format `git diff` would produce for a newly-tracked file so the
 * HUD's diff viewer renders it identically.
 */
function synthesizeAddFilePatch(path: string, content: string): string {
  const lines = content.split('\n')
  // Drop the trailing empty entry from a file ending in '\n' (split
  // returns ['line1', 'line2', ''] for "line1\nline2\n").
  const trailingNewline = content.endsWith('\n')
  if (trailingNewline) lines.pop()
  const header = [
    `diff --git a/${path} b/${path}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ]
  const body = lines.map((l) => '+' + l)
  if (!trailingNewline) body.push('\\ No newline at end of file')
  return header.concat(body).join('\n') + '\n'
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
  // `files` is now a HINT list of touched paths. Accept either the
  // new shape (`string` or `{ path }`) or the legacy shape with a
  // `patch` field (which we ignore — git tells us the real diff).
  // Missing/non-array `files` is permitted (treated as []).
  const files: string[] = []
  const rawFiles = p['files']
  if (rawFiles !== undefined && rawFiles !== null) {
    if (!Array.isArray(rawFiles)) {
      return { ok: false, error: '`files` must be an array if provided' }
    }
    for (const f of rawFiles as unknown[]) {
      if (typeof f === 'string') {
        files.push(f)
      } else if (typeof f === 'object' && f !== null) {
        const fp = f as Record<string, unknown>
        if (typeof fp['path'] === 'string') {
          files.push(fp['path'])
        }
      }
    }
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
  // When the user opted out of streaming, downgrade the claude
  // preset to the single-envelope `json` format before building the
  // spawner — strip `--verbose` and swap `stream-json` → `json`.
  const effectiveConfig: RouterConfig =
    config.streaming === false && presetDefForDowngrade(config)
      ? downgradeStreamingToJson(config)
      : config
  const spawner = config.spawner ?? createCliSpawner(effectiveConfig)
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const concurrency = Math.max(1, config.concurrency ?? 1)
  const log = config.log ?? ((msg) => process.stderr.write(`[llui:router] ${msg}\n`))
  // The CLI name only surfaces in error/log messages — we don't fail
  // the build if the user passes a custom spawner without a command.
  const cliName = config.command ?? PRESETS[config.preset ?? 'claude']?.command ?? 'llm'

  const queue: Array<{ sessionId: string; noteId: string; chainName: string }> = []
  let activeCount = 0
  let stopped = false
  // Per-chain serialization: a chain that's currently in flight is
  // skipped by `drain` until it finishes, even when `activeCount` is
  // below the configured concurrency. Resume semantics require
  // sequential execution within a chain (each spawn needs its
  // predecessor's session id to chain off), so this is enforced
  // unconditionally — `concurrency` only controls parallelism ACROSS
  // chains.
  const activeChains = new Set<string>()
  // Per-chain session ids. Each successful spawn maps its chain name
  // (default `'default'`) to the captured session id; the next task
  // on the same chain resumes from there. Different chains stay
  // independent so a "refactor" thread doesn't bleed into a "ui" one.
  //
  // Persisted to `<notesRoot>/.chain-state.json` so the chain map
  // survives a router restart — the user can keep resuming chains
  // across dev-server cycles. Load on startup; save on each
  // successful capture.
  const CHAIN_STATE_FILE = join(config.notesRoot, '.chain-state.json')
  const sessionByChain = loadChainState(CHAIN_STATE_FILE)
  const DEFAULT_CHAIN = 'default'
  const persistChainState = (): void => {
    try {
      writeFileSync(CHAIN_STATE_FILE, JSON.stringify(Object.fromEntries(sessionByChain)) + '\n')
    } catch (err) {
      log(
        `failed to persist chain state to ${CHAIN_STATE_FILE}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
  const presetDef = config.spawner ? null : PRESETS[config.preset ?? 'claude']
  // Honour `streaming: false` by downgrading stream-json → json. We
  // also strip --verbose + swap the format flag in the args so the
  // CLI doesn't reject the combination.
  let outputEnvelope: 'text' | 'json' | 'stream-json' = presetDef?.outputEnvelope ?? 'text'
  if (config.streaming === false && outputEnvelope === 'stream-json') {
    outputEnvelope = 'json'
  }

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
      // Provenance gate: only spawn for task notes an authenticated in-page
      // writer created. On-disk `intent` alone is not sufficient authority
      // to launch a CLI agent in the project root.
      if (config.trustedTasks && !config.trustedTasks.isTrusted(sessionId, event.id)) {
        log(`skip untrusted task note ${event.id} (no in-page provenance)`)
        return
      }
      const chainName = note.frontmatter.chainName ?? DEFAULT_CHAIN
      queue.push({ sessionId, noteId: event.id, chainName })
    } catch (err) {
      log(`failed to read note ${event.id}: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    void drain()
  }

  const drain = (): void => {
    if (stopped) return
    // Walk the queue, skipping any task whose chain is currently
    // executing. The first task we accept for a given chain claims
    // that chain's slot; subsequent tasks on the same chain stay in
    // the queue and are picked up by the next drain after the
    // current one finishes.
    let i = 0
    while (activeCount < concurrency && i < queue.length) {
      const candidate = queue[i]!
      if (activeChains.has(candidate.chainName)) {
        i++
        continue
      }
      queue.splice(i, 1)
      activeChains.add(candidate.chainName)
      activeCount++
      void (async () => {
        try {
          await processTask(candidate.sessionId, candidate.noteId)
        } finally {
          activeCount--
          activeChains.delete(candidate.chainName)
          if (!stopped) drain()
        }
      })()
    }
  }

  // Best-effort wrapper around `appendStatus`. The session dir may
  // have been cleaned out (e.g. test tmpdir teardown, manual rm)
  // while a task was still in-flight; tolerate that and log instead
  // of propagating the rejection. Status loss in that case is benign
  // — the dir is gone anyway.
  const safeAppendStatus = (sessionDir: string, transition: StatusTransition): void => {
    try {
      appendStatus(sessionDir, transition)
    } catch (err) {
      log(
        `appendStatus failed for ${transition.noteId} → ${transition.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
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
    safeAppendStatus(sessionDir, claimT)
    config.bus.broadcast({
      type: 'status-changed',
      noteId,
      from: cur,
      to: 'claimed',
    })

    let prompt = buildPrompt(sessionId, noteId, config.notesRoot, {
      ...(resolvedContextFiles.length > 0 ? { contextFiles: resolvedContextFiles } : {}),
      log,
    })

    // Optional consumer-supplied prompt transform — runs AFTER the
    // built-in assembly so the hook sees everything the LLM would
    // otherwise receive. Errors here are non-fatal: we log and use
    // the unmodified prompt rather than failing the solve.
    if (config.beforePrompt) {
      const noteRead = readNote(config.notesRoot, sessionId, noteId)
      try {
        const transformed = await config.beforePrompt({
          prompt,
          note: {
            sessionId,
            noteId,
            frontmatter: noteRead.frontmatter,
            prose: noteRead.prose,
          },
        })
        if (typeof transformed === 'string') prompt = transformed
        else log(`beforePrompt returned non-string; using original prompt`)
      } catch (err) {
        log(
          `beforePrompt threw: ${err instanceof Error ? err.message : String(err)}; using original prompt`,
        )
      }
    }

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
    const chainName = note.frontmatter.chainName ?? DEFAULT_CHAIN
    const chainSessionId = sessionByChain.get(chainName)
    const extraArgs: string[] = []
    if (wantsResume && presetDef?.resumeFlag && chainSessionId) {
      extraArgs.push(presetDef.resumeFlag, chainSessionId)
      // No concurrency warning anymore — `drain` serializes
      // per-chain, so two tasks in the same chain never run
      // simultaneously. `concurrency > 1` parallelism applies only
      // across distinct chains.
    }

    // ── Progress state for live feedback during solve ──
    // We accumulate updates from each stream-json line (or every 5s
    // for non-streaming presets) and broadcast a coalesced
    // `task-progress` SSE event so the HUD's status line updates
    // continuously instead of staying frozen until claude exits.
    const taskStartMs = Date.now()
    // Running totals derived from stream-json updates:
    //   - ctxIn: latest input_tokens (grows monotonically — current
    //     context size)
    //   - outTotal: SUM of per-turn output_tokens from assistant
    //     messages, or the cumulative total from the result message
    //   - cacheRead: latest cache_read_input_tokens (shows how much
    //     of the context was served from claude's prompt cache)
    const progress: {
      ctxIn?: number
      outTotal?: number
      cacheRead?: number
      toolSummary?: string
      streamedSessionId?: string
      finalText?: string
    } = {}
    let progressBroadcastTimer: ReturnType<typeof setTimeout> | null = null
    const broadcastProgress = (): void => {
      // 250ms coalesce: when many stream-json lines arrive in a burst
      // (e.g. claude finishing a tool result + starting the next
      // assistant turn) we don't flood the SSE wire.
      if (progressBroadcastTimer) return
      progressBroadcastTimer = setTimeout(() => {
        progressBroadcastTimer = null
        const tokens =
          progress.ctxIn !== undefined || progress.outTotal !== undefined
            ? {
                in: progress.ctxIn ?? 0,
                out: progress.outTotal ?? 0,
                ...(progress.cacheRead !== undefined ? { cacheRead: progress.cacheRead } : {}),
              }
            : undefined
        config.bus.broadcast({
          type: 'task-progress',
          noteId,
          elapsedMs: Date.now() - taskStartMs,
          ...(tokens ? { tokens } : {}),
          ...(progress.toolSummary ? { toolSummary: progress.toolSummary } : {}),
        })
      }, 250)
    }

    // Non-streaming presets get an elapsed-time-only heartbeat every
    // 5s so the HUD still shows liveness. Streaming presets get
    // per-line updates instead.
    let heartbeat: ReturnType<typeof setInterval> | null = null
    if (outputEnvelope !== 'stream-json') {
      heartbeat = setInterval(() => {
        config.bus.broadcast({
          type: 'task-progress',
          noteId,
          elapsedMs: Date.now() - taskStartMs,
        })
      }, 5000)
    }

    const onStdoutLine =
      outputEnvelope === 'stream-json'
        ? (line: string): void => {
            const u = parseStreamJsonLine(line)
            if (!u) return
            if (u.sessionId) progress.streamedSessionId = u.sessionId
            if (u.usage) {
              // input_tokens grows monotonically with each turn; the
              // latest value is the current context size.
              if (u.usage.inputTokens !== undefined) progress.ctxIn = u.usage.inputTokens
              // output_tokens: assistant messages carry per-turn
              // counts (sum them); the final result carries the
              // cumulative total (overwrite).
              if (u.usage.outputTokens !== undefined) {
                if (u.messageType === 'result') {
                  progress.outTotal = u.usage.outputTokens
                } else if (u.messageType === 'assistant') {
                  progress.outTotal = (progress.outTotal ?? 0) + u.usage.outputTokens
                }
              }
              if (u.usage.cacheReadInputTokens !== undefined) {
                progress.cacheRead = u.usage.cacheReadInputTokens
              }
            }
            if (u.toolSummary) progress.toolSummary = u.toolSummary
            if (u.finalText !== undefined) progress.finalText = u.finalText
            broadcastProgress()
          }
        : undefined

    // Snapshot the working tree state BEFORE the LLM runs. We use
    // this to compute claude's actual changes via `git diff` and to
    // distinguish claude's edits from pre-existing modifications.
    // The snapshot doesn't move/touch any files — purely read.
    const gitBaseline = captureGitBaseline(config.projectRoot)

    try {
      const result = await spawner.spawn({
        prompt,
        cwd: config.projectRoot,
        timeoutMs,
        ...(extraArgs.length > 0 ? { extraArgs } : {}),
        ...(onStdoutLine ? { onStdoutLine } : {}),
      })

      if (heartbeat) clearInterval(heartbeat)
      if (progressBroadcastTimer) {
        clearTimeout(progressBroadcastTimer)
        progressBroadcastTimer = null
      }

      // Quick fails before parsing — these don't get a reply note.
      if (result.timedOut) {
        return fail(`${cliName} timed out after ${timeoutMs}ms`)
      }
      if (result.exitCode !== 0) {
        const tail = result.stderr ? `: ${result.stderr.slice(0, 200)}` : ''
        return fail(`${cliName} exited ${result.exitCode}${tail}`)
      }

      // Unwrap the envelope to get the assistant text + session_id.
      //   - stream-json: progress state already has both
      //   - json: parse the single envelope object
      //   - text: stdout IS the assistant text; no session id to capture
      let assistantText = result.stdout
      if (outputEnvelope === 'stream-json') {
        if (progress.finalText !== undefined) {
          assistantText = progress.finalText
        }
        if (progress.streamedSessionId) {
          sessionByChain.set(chainName, progress.streamedSessionId)
          persistChainState()
        }
        if (progress.finalText === undefined) {
          log(`warning: ${cliName} stream-json missing a final result message; resume chain reset`)
        }
      } else if (outputEnvelope === 'json') {
        const envelope = parseCliJsonEnvelope(result.stdout)
        if (envelope) {
          assistantText = envelope.result
          if (envelope.session_id) {
            sessionByChain.set(chainName, envelope.session_id)
            persistChainState()
          }
        } else {
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

      // Compute the actual diff from git rather than trusting the
      // LLM to construct a valid unified diff. Compares the post-
      // spawn working tree against the baseline captured above; any
      // file claude modified shows up in `files[].patch`, and any
      // file claude CREATED gets a synthesized add-file patch.
      const diffFiles = computeGitDiffSinceBaseline(config.projectRoot, gitBaseline, log)
      const proposedDiff: ProposedDiff = {
        files: diffFiles,
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
      // The router writes reply notes directly via the store API,
      // bypassing the POST /_llui/notes middleware that normally
      // broadcasts `note-created`. Without this explicit broadcast
      // the browse view's SSE listener never learns about reply
      // notes and the user has to hit the refresh button to see
      // them.
      config.bus.broadcast({
        type: 'note-created',
        id: replyResult.id,
        filename: replyResult.filename,
        author: 'llm',
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
      safeAppendStatus(sessionDir, proposedT)
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
        safeAppendStatus(sessionDir, failT)
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
      if (heartbeat) clearInterval(heartbeat)
      if (progressBroadcastTimer) clearTimeout(progressBroadcastTimer)
      const message = err instanceof Error ? err.message : String(err)
      const failT: StatusTransition = {
        ts: new Date().toISOString(),
        noteId,
        from: 'claimed',
        to: 'failed',
        by: 'system',
        reason: `spawn error: ${message}`,
      }
      safeAppendStatus(sessionDir, failT)
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
