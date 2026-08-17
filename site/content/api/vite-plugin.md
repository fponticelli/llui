---
title: '@llui/vite-plugin'
description: 'Wires the @llui/compiler signal transform into Vite — view lowering, introspection, lint-as-error diagnostics'
---

# @llui/vite-plugin

<!-- package-version:start -->

**Current package version:** `0.12.1`

<!-- package-version:end -->

Vite adapter for [LLui](https://github.com/fponticelli/llui). Wires the `@llui/compiler` signal transform into Vite — lowering signal expressions in component views to runtime helpers, emitting introspection metadata, and surfacing the signal lint rules as non-bypassable build errors. There is no virtual DOM.

```bash
pnpm add -D @llui/vite-plugin
```

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
})
```

## Options

```ts
llui({
  mcpPort: 5200, // MCP debug server port (default: 5200, false to disable)
})
```

## What It Does

The plugin runs a single **signal transform** (`@llui/compiler`) over every `.ts`/`.tsx`
file using the TypeScript Compiler API:

| Step                   | What it does                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View lowering          | Lowers signal expressions in a component's DIRECT view to runtime helpers (`signalText` / `el` / `react` / `signalEach` / `signalShow` / `signalBranch` / …). An optimization — anything it can't lower runs via the runtime authoring helpers, so both forms coexist. |
| Introspection metadata | Emits component / msg / state metadata (and, via opt-in compiler modules, agent schemas and devtools `__componentMeta`).                                                                                                                                               |
| Lint rules             | Runs the signal lint set as **non-bypassable build errors** (surfaced via `this.error()`): `peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`, `empty-props`, plus shared cross-file / agent / convention checks.                |

## Diagnostics

The compiler emits warnings for common issues:

| Diagnostic            | Description                                      |
| --------------------- | ------------------------------------------------ |
| Missing alt attribute | Accessibility: `img` without `alt`               |
| Non-exhaustive update | `update()` switch missing msg type cases         |
| Empty props           | Element helper called with empty props object    |
| Namespace imports     | `import * as` prevents tree-shaking              |
| Spread children       | Spread in children array defeats static analysis |

<!-- auto-api:start -->

## Functions

### `resolveRouterInput()`

Normalize the user's `router` setting into the public `LlmRouterConfig`
shape (or null when disabled). Accepts `false`, a preset string, or
a full config object. Used in `configResolved` so the rest of the
plugin (router startup + HUD bootstrap) sees one canonical shape.

OPT-IN by default: an unset `router` resolves to `null` (disabled). The
attention router auto-spawns an LLM CLI (with tool access) in the project
root, so it must never turn on implicitly — a forgeable same-origin/loopback
task note reaching a default-on router is a local-RCE path. Enabling it
requires an explicit `router: 'claude'` (or a full config object).

```typescript
function resolveRouterInput(
  router: false | LlmPreset | LlmRouterConfig | undefined,
  legacyTimeoutMs: number | undefined,
): LlmRouterConfig | null
```

## Types

### `AgentPluginConfig`

Reserved for future agent-server config. Empty today — opaque tokens
(post-0.0.35) need no signing key, and the dev server hard-codes the
identity resolver to `'dev-user'`. The shape is kept so callers can
pass `agent: { ... }` and we can grow options without churning the
public type.

```typescript
export type AgentPluginConfig = Record<string, never>
```

### `Annotation`

```typescript
export type Annotation =
  | ({
      type: 'rect'
    } & NoteRect & {
        label?: string
      })
  | {
      type: 'element'
      selector: string
      bbox: NoteRect
      label?: string
    }
```

### `Author`

```typescript
export type Author = 'human' | 'llm'
```

### `CaptureLevel`

```typescript
export type CaptureLevel = 'standard' | 'verbose'
```

### `LogLevel`

```typescript
export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'
```

### `NoteIntent`

```typescript
export type NoteIntent = 'task' | 'note'
```

### `NoteKind`

```typescript
export type NoteKind = 'rect' | 'element' | 'text' | 'capture' | 'reply'
```

### `NoteStatus`

```typescript
export type NoteStatus =
  | 'open'
  | 'claimed'
  | 'in-progress'
  | 'proposed'
  | 'accepted'
  | 'applied'
  | 'rejected'
  | 'wontfix'
  | 'failed'
```

### `ServerEvent`

```typescript
export type ServerEvent =
  | {
      type: 'note-created'
      id: string
      filename: string
      author: Author
    }
  | {
      type: 'note-updated'
      id: string
      sessionId: string
    }
  | {
      type: 'note-deleted'
      id: string
      sessionId: string
    }
  | {
      type: 'task-progress'
      noteId: string
      elapsedMs: number
      /** Token counters from the LLM stream.
       *   - `in`: latest cumulative input_tokens (context size). Grows
       *           monotonically across the conversation.
       *   - `out`: sum of all output_tokens generated so far.
       *   - `cacheRead`: prompt-cache hits, if the model reports them
       *           (claude's `cache_read_input_tokens`). Shows how much
       *           of the context was served from cache vs. reprocessed. */
      tokens?: {
        in: number
        out: number
        cacheRead?: number
      }
      toolSummary?: string
    }
  | {
      type: 'capture-request'
      requestId: string
      payload: CaptureRequestPayload
    }
  | {
      type: 'capture-request-cancelled'
      requestId: string
    }
  | {
      type: 'session-rotated'
      sessionId: string
    }
  | {
      type: 'status-changed'
      noteId: string
      from: NoteStatus | null
      to: NoteStatus
      /** Optional human-readable context — e.g. the LLM's proposed-fix
       *  summary, a failure message, or a git-apply conflict. The HUD
       *  surfaces this verbatim in its status line. */
      reason?: string
    }
```

### `SseRole`

```typescript
export type SseRole = 'hud' | 'mcp' | 'viewer'
```

## Interfaces

### `AgentSchemaSummary`

```typescript
export interface AgentSchemaSummary {
  msg: string
  fields: Record<string, string>
}
```

### `CaptureRequestPayload`

```typescript
export interface CaptureRequestPayload {
  route?: string
  url?: string
  selector?: string
  annotate?: Annotation[]
  prose?: string
  waitForMessage?: string
  captureLevel?: CaptureLevel
  timeoutMs?: number
}
```

### `CaptureRequestResponse`

```typescript
export interface CaptureRequestResponse {
  requestId: string
  status: 'fulfilled' | 'timeout' | 'no-client'
  note?: CreateNoteResponse
}
```

### `ComponentMetaRef`

```typescript
export interface ComponentMetaRef {
  file: string
  line: number
  name: string
}
```

### `ConsoleLogEntry`

```typescript
export interface ConsoleLogEntry {
  ts: string
  level: LogLevel
  text: string
}
```

### `CreateNoteRequest`

```typescript
export interface CreateNoteRequest {
  body: string
  frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'>
  noteBody: NoteBody
  screenshot?: string
}
```

### `CreateNoteResponse`

```typescript
export interface CreateNoteResponse {
  id: string
  filename: string
  path: string
  sessionId: string
}
```

### `CurrentSessionResponse`

```typescript
export interface CurrentSessionResponse {
  sessionId: string
  startedAt: string
  notesDir: string
}
```

### `DevmodeAnnotateConfig`

````typescript
export interface DevmodeAnnotateConfig {
  /** Override the on-disk notes root. Relative paths resolve against
   *  the Vite project root. Default: `.llui/notes`. The
   *  `LLUI_NOTES_DIR` env var takes precedence if set. */
  notesDir?: string
  /**
   * Override session-folder naming and/or slug derivation. The
   * id+author+kind prefix of each filename stays fixed so id ordering
   * and filename parsing keep working — only the trailing slug and
   * the session folder name are customizable.
   *
   * ```ts
   * format: {
   *   formatSessionFolder: (d) => `session-${d.toISOString().slice(0, 10)}`,
   *   deriveSlug: (prose) =>
   *     prose.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '') || 'capture',
   * }
   * ```
   *
   * Note: when the MCP server writes notes directly (out-of-process),
   * it uses defaults — only writes that go through the dev-server
   * middleware (the HUD path) honor these overrides.
   */
  format?: NoteFormatConfig
  /** Override the default capture-request long-poll timeout in
   *  milliseconds. The `LLUI_CAPTURE_TIMEOUT_MS` env var takes
   *  precedence if set. Default: 30000. */
  captureTimeoutMs?: number
  /**
   * The attention router auto-picks up task-mode notes (the developer
   * clicks "Solve" in the HUD) and spawns the configured LLM CLI to
   * propose a fix. Accepts:
   *
   *  - unset / `undefined` — DISABLED (the default). The router is
   *              OPT-IN: it spawns an LLM CLI with tool access in the
   *              project root, so it never turns on implicitly. Notes
   *              still save to disk; the HUD hides its "Solve" button.
   *  - `false` — explicitly disable (same effect as unset).
   *  - `'claude' | 'codex' | 'gemini'` — enable with a preset.
   *  - `LlmRouterConfig` — preset + overrides (model, timeoutMs,
   *              concurrency, env, extraArgs), or a fully custom
   *              invocation `{ command, args, promptVia }` (omit
   *              `preset` to opt out of preset defaults entirely). Set
   *              `dangerouslySkipPermissions: true` to run the agent
   *              fully unattended (no approval prompts) — dangerous.
   *
   * When the chosen CLI isn't on PATH the router degrades silently
   * to save-only and the HUD hides the Solve button — the user gets
   * a one-line install hint in the console.
   *
   * Default: disabled (opt-in).
   */
  router?: false | LlmPreset | LlmRouterConfig
  /** Override the per-task timeout for the router's spawn. Default
   *  5 minutes. Deprecated alias for `router.timeoutMs`. */
  routerTimeoutMs?: number
  /**
   * Controls the in-app HUD (`@llui/devmode-annotate`) auto-injection.
   *
   *  - `true` / omitted — inject in dev mode (default).
   *  - `false`          — skip injection. The notes API stays live so
   *                       MCP can still consume the notebook; only the
   *                       floating button + modal are skipped.
   *  - `HudInjectionConfig` — inject with forwarded options. Currently
   *                       supports `{ hidden: true }` to mount the HUD
   *                       programmatically (no floating button).
   *
   * Injection silently no-ops when `@llui/devmode-annotate` isn't
   * resolvable from the project root.
   */
  hud?: boolean | HudInjectionConfig
}
````

### `DirtyTraceEntry`

```typescript
export interface DirtyTraceEntry {
  component: string
  pathsTracked: string[]
  mask: number
  maskHi?: number
  lastFlippedBits: string[]
}
```

### `HudInjectionConfig`

```typescript
export interface HudInjectionConfig {
  /** Mount the HUD without rendering the floating button. The
   *  keyboard shortcut + programmatic API still work. */
  hidden?: boolean
  /** When `true` (default), the HUD installs `window.onerror` +
   *  `unhandledrejection` listeners. On an uncaught error it opens
   *  the modal pre-populated with the stack + a screenshot — turns
   *  "I saw something weird but can't reproduce it" into a
   *  one-click solve. Set `false` to opt out of the listeners
   *  entirely. */
  autoCaptureOnError?: boolean
  /** When `true` (default), the HUD shows a "● Record" toggle that
   *  captures clicks/inputs/route-changes/messages between toggle-on
   *  and submit, attaching them to the note for the LLM to replay.
   *  Set `false` to hide the toggle and skip the listener setup. */
  repro?: boolean
  /** When `true` (default), the HUD exposes the "⌖ Pick element"
   *  annotation mode alongside "⌖ Add region". Set `false` to hide
   *  the picker affordance. */
  elementPick?: boolean
}
```

### `ListNotesQuery`

```typescript
export interface ListNotesQuery {
  sessionId?: string
  author?: Author
  kind?: NoteKind | NoteKind[]
  since?: string
  limit?: number
}
```

### `ListNotesResponse`

```typescript
export interface ListNotesResponse {
  sessionId: string
  notes: NoteSummary[]
  total: number
  /** Present (and non-empty) only when one or more note files failed to
   *  parse. Absent on the clean path so existing consumers are unaffected. */
  errors?: ListNotesError[]
}
```

### `LluiPluginOptions`

```typescript
export interface LluiPluginOptions {
  /**
   * Port for the MCP debug bridge. In dev mode, the runtime relay connects
   * to `ws://127.0.0.1:<port>` so an external `llui-mcp` server can forward
   * tool calls into the running app.
   *
   * When omitted, the plugin checks whether `@llui/mcp` is resolvable from
   * the Vite project root. If yes → defaults to `5200`. If no → stays
   * disabled. This means installing `@llui/mcp` (+ starting its server)
   * Just Works without an explicit config entry. Pass an explicit `false`
   * to opt out even when `@llui/mcp` is installed; pass a number to use
   * a non-default port. When enabled but the MCP server isn't running,
   * the plugin returns 404 from its discovery endpoint and the browser
   * silently skips the connection — no retry noise.
   */
  mcpPort?: number | false

  /**
   * Enables two things together when set:
   *
   *   1. Emits schemas + binding descriptors in prod builds so the
   *      @llui/agent runtime has metadata to advertise over its WS hello
   *      frame.
   *   2. Auto-mounts `@llui/agent/server`'s router at `/agent/*` and its
   *      WS upgrade handler at `/agent/ws` on the Vite dev server — so
   *      plain `vite dev` has working agent endpoints with no extra
   *      server.ts wiring. Requires `@llui/agent` installed; if it isn't,
   *      the plugin warns and skips dev mounting (prod emission still
   *      works from Plan 3b).
   *
   * Pass `true` for defaults (random signing key per dev session;
   * `identityResolver` returns `'dev-user'`). Pass an object to customize.
   * Default `false` — metadata is dev-only, no agent endpoints.
   */
  agent?: boolean | AgentPluginConfig

  /**
   * Whether any component in the app uses `each()`'s `enter` / `leave`
   * / `onTransition` options. When `false` (the default), the
   * vite-plugin substitutes `__LLUI_TRANSITIONS__ = false` into the
   * runtime bundle; Vite's dead-code eliminator then drops the
   * per-entry enter/leave helpers, the `leaving` queue plumbing, and
   * the `report` allocation in `each()`'s reconcile path. Saves
   * ~0.3 kB gz on jfb-shape bundles that don't animate.
   *
   * Apps using `@llui/transitions` or any custom `each({ enter, leave,
   * onTransition })` MUST pass `transitions: true` — otherwise the
   * options will be silently ignored at runtime.
   */
  transitions?: boolean

  /**
   * Surface compiler `perf` diagnostics as Vite warnings. Currently one
   * diagnostic exists: `llui/each-verbatim` — an `each` whose rows did not
   * compile to the cloneNode RowFactory (nor the render-callback lowering)
   * and render via the runtime authoring path instead, paying per-row
   * construction overhead. The message names the bail reason(s) with an
   * actionable hint (e.g. a row delegating to an imported helper, spread
   * connect-part props, an imperative render body).
   *
   * Advisory only — never blocks the build (a verbatim `each` is fully
   * correct, just slower per row). **Default: on in dev mode, off in
   * build.** Pass `false` to silence, `true` to also warn during builds.
   */
  perfDiagnostics?: boolean

  /**
   * Controls the devmode-annotate notebook surface — a single Connect
   * middleware mounted at `/_llui/*` that lets the HUD
   * (`@llui/devmode-annotate`) and the MCP server (`@llui/mcp`) read
   * and write a shared on-disk notebook under `.llui/notes/`. The HUD
   * developer drops notes from the running app; the LLM consumes them
   * via MCP subscriptions; both can initiate captures.
   *
   * **Default: on in dev mode.** Omitting the option (or passing `true`)
   * registers the middleware automatically — there's nothing to do.
   * Pass `false` to opt out (no routes registered, middleware tree-
   * shakes). Pass an object to keep it on while customizing the notes
   * directory or default timeout.
   *
   * The HUD is **auto-injected** in dev mode: the plugin emits a
   * `<script type="module">` into the served HTML that imports
   * `@llui/devmode-annotate` and mounts the floating button. Production
   * builds never run `configureServer` or `transformIndexHtml(dev)`, so
   * this is dev-only by construction. Disable just the HUD (keeping the
   * notes API on) with `devmodeAnnotate: { hud: false }`; disable
   * everything with `devmodeAnnotate: false`. The HUD package must be
   * resolvable from the project root — install
   * `@llui/devmode-annotate` alongside `@llui/vite-plugin`.
   *
   * Environment overrides (honored when not opted out):
   *   - `LLUI_NOTES_DIR` — override the notes root path
   *   - `LLUI_CAPTURE_TIMEOUT_MS` — override the default capture-request timeout
   *
   * The proposal (`docs/proposals/devmode-annotate/`) details what
   * lands on disk and what the LLM gets.
   */
  devmodeAnnotate?: boolean | DevmodeAnnotateConfig
}
```

### `MessageLogEntry`

```typescript
export interface MessageLogEntry {
  ts: string
  component: string
  msg: unknown
}
```

### `NoteBody`

```typescript
export interface NoteBody {
  stateSnapshot?: unknown
  messageLog?: MessageLogEntry[]
  consoleLog?: ConsoleLogEntry[]
  pendingMessages?: PendingMessage[]
  effects?: {
    pending: PendingEffectEntry[]
    recent: RecentEffectEntry[]
  }
  dirtyTrace?: DirtyTraceEntry[]
  structuralAt?: StructuralSnapshot
  sourceMap?: SourceMapEntry[]
  errors?: RuntimeErrorEntry[]
  /** Captured user interactions from the HUD's repro recorder. The
   *  LLM uses this to understand what the developer did before the
   *  bug appeared. Times are milliseconds from the start of the
   *  recording, not absolute. */
  repro?: ReproEvent[]
  verbose?: VerboseNoteBody
}
```

### `NoteFrontmatter`

```typescript
export interface NoteFrontmatter {
  id: string
  ts: string
  author: Author
  kind: NoteKind
  captureLevel: CaptureLevel
  url: string
  route: string | null
  routeParams: Record<string, string>
  viewport: {
    w: number
    h: number
    dpr: number
  }
  componentPath: string[] | null
  componentMeta: ComponentMetaRef | null
  annotations: Annotation[]
  screenshot: string | null
  agentSchemas: AgentSchemaSummary[]
  llui: {
    runtime: string
    compiler: string
  }
  fulfillsRequestId?: string
  intent?: NoteIntent
  replyTo?: string
  proposedDiff?: ProposedDiff
  /** When true (default true for HUD-originated tasks), the router
   *  spawns the LLM with its resume-previous-conversation flag (e.g.
   *  `claude --continue`) so the LLM keeps prior context. Presets
   *  without a resume flag treat this as a no-op. */
  resume?: boolean
  /** Name of the resume chain this task participates in. The router
   *  keeps a map of chain name → last session id and passes the
   *  corresponding id via `--resume` when `resume: true`. Lets the
   *  user maintain independent conversation threads (e.g. "refactor",
   *  "ui-polish") without them stomping on each other. Default
   *  `'default'`. */
  chainName?: string
}
```

### `NoteRect`

```typescript
export interface NoteRect {
  x: number
  y: number
  w: number
  h: number
}
```

### `NoteSummary`

```typescript
export interface NoteSummary {
  id: string
  sessionId: string
  filename: string
  ts: string
  author: Author
  kind: NoteKind
  url: string
  componentPath: string[] | null
  preview: string
  hasScreenshot: boolean
  /** Frontmatter shortcuts surfaced in the list so the HUD can
   *  rehydrate trackedTasks + chainHistories on reload without
   *  fetching each note individually. Optional for back-compat with
   *  servers that don't populate them. */
  intent?: NoteIntent
  chainName?: string
  /** For reply notes only — the original task this reply addresses. */
  replyTo?: string
  /** For reply notes only — the LLM's one-line summary of the
   *  proposed change (extracted from proposedDiff). */
  proposedSummary?: string
}
```

### `PendingEffectEntry`

```typescript
export interface PendingEffectEntry {
  id: string
  component: string
  effect: unknown
  sinceMs: number
}
```

### `PendingMessage`

```typescript
export interface PendingMessage {
  component: string
  msg: unknown
}
```

### `ProposedDiff`

```typescript
export interface ProposedDiff {
  files: Array<{
    path: string
    patch: string
  }>
  summary: string
  confidence: 'high' | 'medium' | 'low'
}
```

### `RecentEffectEntry`

```typescript
export interface RecentEffectEntry {
  ts: string
  component: string
  effect: unknown
  outcome: 'ok' | 'error' | 'cancelled'
  error?: string
}
```

### `RuntimeErrorEntry`

```typescript
export interface RuntimeErrorEntry {
  ts: string
  kind: 'runtime' | 'compiler'
  file?: string
  line?: number
  message: string
  stack?: string
}
```

### `SourceMapEntry`

```typescript
export interface SourceMapEntry {
  selector: string
  file: string
  line: number
  componentPath: string[]
}
```

### `StatusTransition`

```typescript
export interface StatusTransition {
  ts: string
  noteId: string
  from: NoteStatus | null
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}
```

### `StructuralSnapshot`

```typescript
export interface StructuralSnapshot {
  branches: Array<{
    at: string
    activeArm: string
  }>
  shows: Array<{
    at: string
    visible: boolean
  }>
  eachKeys: Array<{
    at: string
    keys: string[]
  }>
}
```

### `VerboseNoteBody`

```typescript
export interface VerboseNoteBody {
  scopeTree?: Array<{
    id: string
    parent: string | null
    component: string
    key?: string
  }>
  bindings?: {
    total: number
    hottest: Array<{
      component: string
      path: string
      firesPerSec: number
    }>
    lastCycleMs: number
  }
  agentBridge?: {
    connectedAgents: string[]
    pendingToolCalls: number
    recentMsgs: Array<{
      ts: string
      direction: 'in' | 'out'
      payload: unknown
    }>
  }
  transitionsInFlight?: Array<{
    component: string
    name: string
    progress: number
  }>
  foreignInstances?: Array<{
    component: string
    library: string
  }>
}
```

## Public Entry Points

### `@llui/vite-plugin/notes`

#### Functions

##### `acquireClaimLock()` from `@llui/vite-plugin/notes`

Acquire an exclusive claim on a note via an `O_CREAT | O_EXCL` lock file
(`<noteId>.claim`) — the arbiter for cross-process claiming. Exactly ONE
caller wins the exclusive create; every other caller gets `EEXIST` and
reads the winner's `workerId` back out of the file. This closes the
read-then-append TOCTOU where two workers both observed `open` status and
both appended a `claimed` transition.

The lock file is a permanent record (it is NOT released) so a later claim
of the same note is reported as already-claimed by the recorded holder.

```typescript
function acquireClaimLock(sessionDir: string, noteId: string, workerId: string): ClaimLockOutcome
```

##### `appendStatus()` from `@llui/vite-plugin/notes`

Append a transition to status.jsonl. The file is created on first
append. `from` is the current status (or null on the first
transition for this note) so the line is self-describing.

```typescript
function appendStatus(sessionDir: string, transition: StatusTransition): void
```

##### `checkSameOriginLoopback()` from `@llui/vite-plugin/notes`

Reject any mutating request that isn't a same-origin call to a loopback
host. Returns `null` when the request is allowed, or an error message
describing the rejection (the caller answers with 403).

```typescript
function checkSameOriginLoopback(req: IncomingMessage): string | null
```

##### `cleanupResolvedTask()` from `@llui/vite-plugin/notes`

Delete a resolved task note's files: the task .md + .png plus every
reply note (`replyTo === taskNoteId`) and their screenshots. The
status.jsonl audit log is preserved — those transitions stay as a
trail of what happened.

Used by the middleware when a task transitions to `applied` (the
success path). Idempotent: missing files are skipped silently.

Returns the list of deleted filenames (sans the session dir prefix)
so the caller can log/broadcast.

```typescript
function cleanupResolvedTask(notesRoot: string, sessionId: string, taskNoteId: string): string[]
```

##### `createCaptureRegistry()` from `@llui/vite-plugin/notes`

```typescript
function createCaptureRegistry(): CaptureRegistry
```

##### `createEventBus()` from `@llui/vite-plugin/notes`

```typescript
function createEventBus(): EventBus
```

##### `createNote()` from `@llui/vite-plugin/notes`

```typescript
function createNote(
  notesRoot: string,
  req: CreateNoteRequest,
  format: NoteFormatConfig = {},
): CreateNoteResponse
```

##### `createNotesMiddleware()` from `@llui/vite-plugin/notes`

```typescript
function createNotesMiddleware(config: NotesMiddlewareConfig): MiddlewareHandler
```

##### `createTrustedTaskRegistry()` from `@llui/vite-plugin/notes`

```typescript
function createTrustedTaskRegistry(): TrustedTaskRegistry
```

##### `currentStatus()` from `@llui/vite-plugin/notes`

Current status for a note: last `to` value, or null when no
transitions exist (= the note hasn't entered the status machine).

```typescript
function currentStatus(sessionDir: string, noteId: string): NoteStatus | null
```

##### `defaultSessionName()` from `@llui/vite-plugin/notes`

Default UTC session folder name: `session-YYYY-MM-DD-HHMM`.

```typescript
export declare function defaultSessionName(d: Date): string
```

##### `deleteNote()` from `@llui/vite-plugin/notes`

Delete a note: the .md file + its sibling .png screenshot (if any).
Returns the list of paths actually removed. Idempotent — missing
files are skipped. The session-wide `status.jsonl` is intentionally
left alone; orphan transitions for the deleted note are harmless
since downstream readers filter by id.

```typescript
function deleteNote(notesRoot: string, sessionId: string, id: string): string[]
```

##### `deriveFilename()` from `@llui/vite-plugin/notes`

```typescript
export declare function deriveFilename(
  id: string,
  author: Author,
  kind: NoteKind,
  slug: string,
): string
```

##### `deriveSlug()` from `@llui/vite-plugin/notes`

```typescript
export declare function deriveSlug(prose: string): string
```

##### `ensureNotesRoot()` from `@llui/vite-plugin/notes`

Ensures a directory exists, no-op if already present. Used by callers
that want to materialize the notes root before any note is written
(e.g. middleware startup).

```typescript
function ensureNotesRoot(notesRoot: string): void
```

##### `ensureSession()` from `@llui/vite-plugin/notes`

Ensure a session subdirectory exists. Does NOT touch the marker file —
use rotateSession or resolveCurrentSession for that.

```typescript
function ensureSession(notesRoot: string, sessionId: string): string
```

##### `importBundle()` from `@llui/vite-plugin/notes`

Import an export bundle (zip bytes) into `notesRoot`. Returns a summary;
throws on a malformed bundle, schema mismatch, or unsafe entry paths.

```typescript
function importBundle(
  notesRoot: string,
  zip: Uint8Array,
  options: ImportBundleOptions = {},
): ImportBundleResult
```

##### `isClaudeAvailable()` from `@llui/vite-plugin/notes`

Back-compat — prefer `isCliAvailable('claude')`.

```typescript
function isClaudeAvailable(): boolean
```

##### `isJsonContentType()` from `@llui/vite-plugin/notes`

Whether the request declares a JSON body.

```typescript
function isJsonContentType(req: IncomingMessage): boolean
```

##### `listNotes()` from `@llui/vite-plugin/notes`

```typescript
function listNotes(notesRoot: string, query: ListNotesQuery): ListNotesResponse
```

##### `listQueue()` from `@llui/vite-plugin/notes`

Materialize per-note status by replaying every transition. Returns
one entry per noteId that has ever been touched; filter by status
via `filter`.

```typescript
function listQueue(
  sessionDir: string,
  filter?: { status?: NoteStatus | NoteStatus[] },
): QueueEntry[]
```

##### `listSessions()` from `@llui/vite-plugin/notes`

```typescript
function listSessions(notesRoot: string): SessionListEntry[]
```

##### `padId()` from `@llui/vite-plugin/notes`

3-digit zero-padded session-local sequence id (001, 002, … then 1000+).

```typescript
export declare function padId(n: number): string
```

##### `parseNote()` from `@llui/vite-plugin/notes`

```typescript
export declare function parseNote(markdown: string): SerializedNote
```

##### `readAllTransitions()` from `@llui/vite-plugin/notes`

Read every transition in the session log, regardless of note id.
Used by listQueue() to materialize the current status of all notes.

```typescript
function readAllTransitions(sessionDir: string): StatusTransition[]
```

##### `readCurrentSessionFile()` from `@llui/vite-plugin/notes`

```typescript
function readCurrentSessionFile(notesRoot: string): string | null
```

##### `readNote()` from `@llui/vite-plugin/notes`

```typescript
function readNote(notesRoot: string, sessionId: string, id: string): SerializedNote
```

##### `readScreenshot()` from `@llui/vite-plugin/notes`

```typescript
function readScreenshot(notesRoot: string, sessionId: string, id: string): Buffer | null
```

##### `readStatusHistory()` from `@llui/vite-plugin/notes`

Read the full status history for a single note id, in chronological
order. Empty array when the file doesn't exist or the note has no
transitions.

```typescript
function readStatusHistory(sessionDir: string, noteId: string): StatusTransition[]
```

##### `resolveCurrentSession()` from `@llui/vite-plugin/notes`

Resolve the current session: reuse the one named by current-session if
present, otherwise mint a new one from `defaultSessionName(now())` (or
the env override).

```typescript
function resolveCurrentSession(notesRoot: string, opts: ResolveSessionOptions = {}): SessionInfo
```

##### `rotateSession()` from `@llui/vite-plugin/notes`

Start a fresh session. The previous session is left on disk; only the
marker moves.

```typescript
function rotateSession(notesRoot: string, opts: ResolveSessionOptions = {}): RotatedSession
```

##### `serializeNote()` from `@llui/vite-plugin/notes`

```typescript
export declare function serializeNote(note: SerializedNote): string
```

##### `startRouter()` from `@llui/vite-plugin/notes`

Start the attention router. Subscribes to the bus and processes
`note-created` events for task-intent notes. Returns a handle that
can stop the router and probe state for tests.

```typescript
function startRouter(config: RouterConfig): RouterHandle
```

##### `updateNoteProse()` from `@llui/vite-plugin/notes`

Replace a note's prose, keeping its frontmatter intact. Returns the
updated SerializedNote. Throws when the note doesn't exist. The
status-history JSONL sidecar is untouched — edits don't reset task
state.

```typescript
function updateNoteProse(
  notesRoot: string,
  sessionId: string,
  id: string,
  newProse: string,
): SerializedNote
```

#### Types

##### `Annotation` from `@llui/vite-plugin/notes`

```typescript
export type Annotation =
  | ({
      type: 'rect'
    } & NoteRect & {
        label?: string
      })
  | {
      type: 'element'
      selector: string
      bbox: NoteRect
      label?: string
    }
```

##### `Author` from `@llui/vite-plugin/notes`

```typescript
export type Author = 'human' | 'llm'
```

##### `CaptureLevel` from `@llui/vite-plugin/notes`

```typescript
export type CaptureLevel = 'standard' | 'verbose'
```

##### `ClaudeSpawner` from `@llui/vite-plugin/notes`

```typescript
export type ClaudeSpawner = LlmSpawner
```

##### `ClaudeSpawnResult` from `@llui/vite-plugin/notes`

```typescript
export type ClaudeSpawnResult = LlmSpawnResult
```

##### `LogLevel` from `@llui/vite-plugin/notes`

```typescript
export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'
```

##### `MiddlewareHandler` from `@llui/vite-plugin/notes`

```typescript
export type MiddlewareHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void
```

##### `NoteIntent` from `@llui/vite-plugin/notes`

```typescript
export type NoteIntent = 'task' | 'note'
```

##### `NoteKind` from `@llui/vite-plugin/notes`

```typescript
export type NoteKind = 'rect' | 'element' | 'text' | 'capture' | 'reply'
```

##### `NoteStatus` from `@llui/vite-plugin/notes`

```typescript
export type NoteStatus =
  | 'open'
  | 'claimed'
  | 'in-progress'
  | 'proposed'
  | 'accepted'
  | 'applied'
  | 'rejected'
  | 'wontfix'
  | 'failed'
```

##### `ServerEvent` from `@llui/vite-plugin/notes`

```typescript
export type ServerEvent =
  | {
      type: 'note-created'
      id: string
      filename: string
      author: Author
    }
  | {
      type: 'note-updated'
      id: string
      sessionId: string
    }
  | {
      type: 'note-deleted'
      id: string
      sessionId: string
    }
  | {
      type: 'task-progress'
      noteId: string
      elapsedMs: number
      /** Token counters from the LLM stream.
       *   - `in`: latest cumulative input_tokens (context size). Grows
       *           monotonically across the conversation.
       *   - `out`: sum of all output_tokens generated so far.
       *   - `cacheRead`: prompt-cache hits, if the model reports them
       *           (claude's `cache_read_input_tokens`). Shows how much
       *           of the context was served from cache vs. reprocessed. */
      tokens?: {
        in: number
        out: number
        cacheRead?: number
      }
      toolSummary?: string
    }
  | {
      type: 'capture-request'
      requestId: string
      payload: CaptureRequestPayload
    }
  | {
      type: 'capture-request-cancelled'
      requestId: string
    }
  | {
      type: 'session-rotated'
      sessionId: string
    }
  | {
      type: 'status-changed'
      noteId: string
      from: NoteStatus | null
      to: NoteStatus
      /** Optional human-readable context — e.g. the LLM's proposed-fix
       *  summary, a failure message, or a git-apply conflict. The HUD
       *  surfaces this verbatim in its status line. */
      reason?: string
    }
```

##### `SseEventListener` from `@llui/vite-plugin/notes`

```typescript
export type SseEventListener = (event: ServerEvent) => void
```

##### `SseRole` from `@llui/vite-plugin/notes`

```typescript
export type SseRole = 'hud' | 'mcp' | 'viewer'
```

#### Interfaces

##### `AgentSchemaSummary` from `@llui/vite-plugin/notes`

```typescript
export interface AgentSchemaSummary {
  msg: string
  fields: Record<string, string>
}
```

##### `CaptureRegistry` from `@llui/vite-plugin/notes`

```typescript
export interface CaptureRegistry {
  submit(payload: CaptureRequestPayload, opts: SubmitOptions): SubmitResult
  fulfill(requestId: string, note: CreateNoteResponse): boolean
  cancel(requestId: string, status: 'timeout' | 'no-client'): boolean
  listPending(): string[]
}
```

##### `CaptureRequestPayload` from `@llui/vite-plugin/notes`

```typescript
export interface CaptureRequestPayload {
  route?: string
  url?: string
  selector?: string
  annotate?: Annotation[]
  prose?: string
  waitForMessage?: string
  captureLevel?: CaptureLevel
  timeoutMs?: number
}
```

##### `CaptureRequestResponse` from `@llui/vite-plugin/notes`

```typescript
export interface CaptureRequestResponse {
  requestId: string
  status: 'fulfilled' | 'timeout' | 'no-client'
  note?: CreateNoteResponse
}
```

##### `CaptureSubmitOptions` from `@llui/vite-plugin/notes`

```typescript
export interface SubmitOptions {
  /** Whether a HUD is currently subscribed. If false, the promise
   *  resolves immediately with status:no-client so the MCP server can
   *  fall through to the Playwright fallback. */
  hudConnected: boolean
  /** ms before the promise resolves with status:timeout. */
  timeoutMs: number
}
```

##### `CaptureSubmitResult` from `@llui/vite-plugin/notes`

```typescript
export interface SubmitResult {
  requestId: string
  promise: Promise<CaptureRequestResponse>
  payload: CaptureRequestPayload
}
```

##### `ClaimLockOutcome` from `@llui/vite-plugin/notes`

```typescript
export interface ClaimLockOutcome {
  /** True only for the single caller that created the lock file. */
  acquired: boolean
  /** The workerId recorded in the lock file — our own id when we won, the
   *  prior winner's id when we lost. `null` when the lock is unreadable. */
  holder: string | null
}
```

##### `ComponentMetaRef` from `@llui/vite-plugin/notes`

```typescript
export interface ComponentMetaRef {
  file: string
  line: number
  name: string
}
```

##### `ConsoleLogEntry` from `@llui/vite-plugin/notes`

```typescript
export interface ConsoleLogEntry {
  ts: string
  level: LogLevel
  text: string
}
```

##### `CreateNoteRequest` from `@llui/vite-plugin/notes`

```typescript
export interface CreateNoteRequest {
  body: string
  frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'>
  noteBody: NoteBody
  screenshot?: string
}
```

##### `CreateNoteResponse` from `@llui/vite-plugin/notes`

```typescript
export interface CreateNoteResponse {
  id: string
  filename: string
  path: string
  sessionId: string
}
```

##### `CurrentSessionResponse` from `@llui/vite-plugin/notes`

```typescript
export interface CurrentSessionResponse {
  sessionId: string
  startedAt: string
  notesDir: string
}
```

##### `DirtyTraceEntry` from `@llui/vite-plugin/notes`

```typescript
export interface DirtyTraceEntry {
  component: string
  pathsTracked: string[]
  mask: number
  maskHi?: number
  lastFlippedBits: string[]
}
```

##### `EventBus` from `@llui/vite-plugin/notes`

```typescript
export interface EventBus {
  subscribe(role: SseRole, listener: SseEventListener): () => void
  broadcast(event: ServerEvent): void
  countByRole(role: SseRole): number
}
```

##### `ImportBundleResult` from `@llui/vite-plugin/notes`

```typescript
export interface ImportBundleResult {
  /** Short stable key derived from the bundle content hash. */
  bundleKey: string
  /** Target session folder names that received notes. */
  importedSessions: string[]
  /** `.md` notes written this run. */
  notesImported: number
  /** `.md` notes already present (idempotent re-import). */
  notesSkipped: number
}
```

##### `ListNotesQuery` from `@llui/vite-plugin/notes`

```typescript
export interface ListNotesQuery {
  sessionId?: string
  author?: Author
  kind?: NoteKind | NoteKind[]
  since?: string
  limit?: number
}
```

##### `ListNotesResponse` from `@llui/vite-plugin/notes`

```typescript
export interface ListNotesResponse {
  sessionId: string
  notes: NoteSummary[]
  total: number
  /** Present (and non-empty) only when one or more note files failed to
   *  parse. Absent on the clean path so existing consumers are unaffected. */
  errors?: ListNotesError[]
}
```

##### `MessageLogEntry` from `@llui/vite-plugin/notes`

```typescript
export interface MessageLogEntry {
  ts: string
  component: string
  msg: unknown
}
```

##### `NoteBody` from `@llui/vite-plugin/notes`

```typescript
export interface NoteBody {
  stateSnapshot?: unknown
  messageLog?: MessageLogEntry[]
  consoleLog?: ConsoleLogEntry[]
  pendingMessages?: PendingMessage[]
  effects?: {
    pending: PendingEffectEntry[]
    recent: RecentEffectEntry[]
  }
  dirtyTrace?: DirtyTraceEntry[]
  structuralAt?: StructuralSnapshot
  sourceMap?: SourceMapEntry[]
  errors?: RuntimeErrorEntry[]
  /** Captured user interactions from the HUD's repro recorder. The
   *  LLM uses this to understand what the developer did before the
   *  bug appeared. Times are milliseconds from the start of the
   *  recording, not absolute. */
  repro?: ReproEvent[]
  verbose?: VerboseNoteBody
}
```

##### `NoteFrontmatter` from `@llui/vite-plugin/notes`

```typescript
export interface NoteFrontmatter {
  id: string
  ts: string
  author: Author
  kind: NoteKind
  captureLevel: CaptureLevel
  url: string
  route: string | null
  routeParams: Record<string, string>
  viewport: {
    w: number
    h: number
    dpr: number
  }
  componentPath: string[] | null
  componentMeta: ComponentMetaRef | null
  annotations: Annotation[]
  screenshot: string | null
  agentSchemas: AgentSchemaSummary[]
  llui: {
    runtime: string
    compiler: string
  }
  fulfillsRequestId?: string
  intent?: NoteIntent
  replyTo?: string
  proposedDiff?: ProposedDiff
  /** When true (default true for HUD-originated tasks), the router
   *  spawns the LLM with its resume-previous-conversation flag (e.g.
   *  `claude --continue`) so the LLM keeps prior context. Presets
   *  without a resume flag treat this as a no-op. */
  resume?: boolean
  /** Name of the resume chain this task participates in. The router
   *  keeps a map of chain name → last session id and passes the
   *  corresponding id via `--resume` when `resume: true`. Lets the
   *  user maintain independent conversation threads (e.g. "refactor",
   *  "ui-polish") without them stomping on each other. Default
   *  `'default'`. */
  chainName?: string
}
```

##### `NoteRect` from `@llui/vite-plugin/notes`

```typescript
export interface NoteRect {
  x: number
  y: number
  w: number
  h: number
}
```

##### `NotesMiddlewareConfig` from `@llui/vite-plugin/notes`

```typescript
export interface NotesMiddlewareConfig {
  notesRoot: string
  bus: EventBus
  registry: CaptureRegistry
  defaultCaptureTimeoutMs?: number
  /** Heartbeat interval for SSE keepalive in ms. Default 15000. */
  sseHeartbeatMs?: number
  /** Override session-folder naming and/or slug derivation. */
  format?: NoteFormatConfig
  /**
   * Provenance registry for task-intent notes. When provided, a task note
   * accepted through this (same-origin, authenticated) middleware is marked
   * here — but ONLY when the request also presents the capability token (see
   * {@link taskCapabilityToken}) — so the attention router only spawns agents
   * for tasks the trusted in-page HUD actually created. Omit to skip
   * provenance recording (the router then falls back to on-disk intent —
   * dev/test only).
   */
  trustedTasks?: TrustedTaskRegistry
  /**
   * Per-launch, unforgeable capability token that authorizes marking a task
   * note trusted (which lets the router spawn a local CLI agent, possibly
   * with `--dangerously-skip-permissions` → local RCE). The plugin generates
   * it and injects it into the HUD bundle out-of-band; the HUD echoes it on
   * the task-create POST via the `x-llui-task-capability` header.
   *
   * SECURITY: same-origin passes the CSRF/loopback guard, so a malicious page
   * script CAN reach this endpoint. It cannot, however, read this token (it
   * lives in the HUD module's closure, never on `window` or in the DOM), so it
   * cannot forge a *trusted* task. Without a matching token the note is still
   * created and enters the status machine, but is NOT marked trusted, so the
   * router will not spawn for it. When unset, NO task is ever marked trusted
   * (secure default) — the plugin always sets it in real dev servers.
   */
  taskCapabilityToken?: string
}
```

##### `NoteSummary` from `@llui/vite-plugin/notes`

```typescript
export interface NoteSummary {
  id: string
  sessionId: string
  filename: string
  ts: string
  author: Author
  kind: NoteKind
  url: string
  componentPath: string[] | null
  preview: string
  hasScreenshot: boolean
  /** Frontmatter shortcuts surfaced in the list so the HUD can
   *  rehydrate trackedTasks + chainHistories on reload without
   *  fetching each note individually. Optional for back-compat with
   *  servers that don't populate them. */
  intent?: NoteIntent
  chainName?: string
  /** For reply notes only — the original task this reply addresses. */
  replyTo?: string
  /** For reply notes only — the LLM's one-line summary of the
   *  proposed change (extracted from proposedDiff). */
  proposedSummary?: string
}
```

##### `PendingEffectEntry` from `@llui/vite-plugin/notes`

```typescript
export interface PendingEffectEntry {
  id: string
  component: string
  effect: unknown
  sinceMs: number
}
```

##### `PendingMessage` from `@llui/vite-plugin/notes`

```typescript
export interface PendingMessage {
  component: string
  msg: unknown
}
```

##### `ProposedDiff` from `@llui/vite-plugin/notes`

```typescript
export interface ProposedDiff {
  files: Array<{
    path: string
    patch: string
  }>
  summary: string
  confidence: 'high' | 'medium' | 'low'
}
```

##### `QueueEntry` from `@llui/vite-plugin/notes`

```typescript
export interface QueueEntry {
  noteId: string
  status: NoteStatus
  transitions: StatusTransition[]
}
```

##### `RecentEffectEntry` from `@llui/vite-plugin/notes`

```typescript
export interface RecentEffectEntry {
  ts: string
  component: string
  effect: unknown
  outcome: 'ok' | 'error' | 'cancelled'
  error?: string
}
```

##### `ResolveSessionOptions` from `@llui/vite-plugin/notes`

```typescript
export interface ResolveSessionOptions {
  /** Override for tests / fixed-seed runs. Defaults to `new Date()`. */
  now?: () => Date
  /** Override for env-based session names (LLUI_SESSION_NAME). */
  sessionName?: string
  /** Format the session folder name from the start date. Overrides
   *  the default UTC `session-YYYY-MM-DD-HHMM` scheme. Ignored when
   *  `sessionName` is explicitly set. */
  formatSessionFolder?: (date: Date) => string
}
```

##### `RotatedSession` from `@llui/vite-plugin/notes`

```typescript
export interface RotatedSession extends SessionInfo {
  previousSessionId: string
}
```

##### `RouterConfig` from `@llui/vite-plugin/notes`

Resolved router config — what `startRouter` ultimately consumes.
Either `spawner` is injected (tests / dependency inversion) OR
the preset/custom fields drive a real child_process.

```typescript
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
```

##### `RouterHandle` from `@llui/vite-plugin/notes`

```typescript
export interface RouterHandle {
  /** Stop the router. Currently-running task continues but no new
   *  tasks will be claimed. */
  stop(): void
  /** Number of tasks pending in the internal queue. Test affordance. */
  queueLength(): number
  /** Whether a task is currently being processed. Test affordance. */
  isBusy(): boolean
}
```

##### `RuntimeErrorEntry` from `@llui/vite-plugin/notes`

```typescript
export interface RuntimeErrorEntry {
  ts: string
  kind: 'runtime' | 'compiler'
  file?: string
  line?: number
  message: string
  stack?: string
}
```

##### `SerializedNote` from `@llui/vite-plugin/notes`

```typescript
export interface SerializedNote {
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
}
```

##### `SessionInfo` from `@llui/vite-plugin/notes`

```typescript
export interface SessionInfo {
  sessionId: string
  /** ISO timestamp at session start (the resolution moment, not the dir mtime). */
  startedAt: string
  /** Absolute path to the session subdirectory. */
  notesDir: string
}
```

##### `SourceMapEntry` from `@llui/vite-plugin/notes`

```typescript
export interface SourceMapEntry {
  selector: string
  file: string
  line: number
  componentPath: string[]
}
```

##### `StatusTransition` from `@llui/vite-plugin/notes`

```typescript
export interface StatusTransition {
  ts: string
  noteId: string
  from: NoteStatus | null
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}
```

##### `StructuralSnapshot` from `@llui/vite-plugin/notes`

```typescript
export interface StructuralSnapshot {
  branches: Array<{
    at: string
    activeArm: string
  }>
  shows: Array<{
    at: string
    visible: boolean
  }>
  eachKeys: Array<{
    at: string
    keys: string[]
  }>
}
```

##### `TrustedTaskRegistry` from `@llui/vite-plugin/notes`

```typescript
export interface TrustedTaskRegistry {
  /** Mark a task note as originating from an authenticated in-page write. */
  mark(sessionId: string, noteId: string): void
  /** Whether this task note was marked trusted. */
  isTrusted(sessionId: string, noteId: string): boolean
}
```

##### `VerboseNoteBody` from `@llui/vite-plugin/notes`

```typescript
export interface VerboseNoteBody {
  scopeTree?: Array<{
    id: string
    parent: string | null
    component: string
    key?: string
  }>
  bindings?: {
    total: number
    hottest: Array<{
      component: string
      path: string
      firesPerSec: number
    }>
    lastCycleMs: number
  }
  agentBridge?: {
    connectedAgents: string[]
    pendingToolCalls: number
    recentMsgs: Array<{
      ts: string
      direction: 'in' | 'out'
      payload: unknown
    }>
  }
  transitionsInFlight?: Array<{
    component: string
    name: string
    progress: number
  }>
  foreignInstances?: Array<{
    component: string
    library: string
  }>
}
```

#### Constants

##### `defaultClaudeSpawner` from `@llui/vite-plugin/notes`

Back-compat: a spawner pre-bound to the `'claude'` preset. Kept for
existing call sites; new code should prefer `createCliSpawner` so
preset, model, env etc. propagate consistently.

```typescript
const defaultClaudeSpawner: LlmSpawner
```

<!-- auto-api:end -->
