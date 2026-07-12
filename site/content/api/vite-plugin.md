---
title: '@llui/vite-plugin'
description: 'Wires the @llui/compiler signal transform into Vite — view lowering, introspection, lint-as-error diagnostics'
---

# @llui/vite-plugin

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
| Lint rules             | Runs the signal lint set as **non-bypassable build errors** (surfaced via `this.error()`): `peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`, plus shared cross-file / agent / convention checks.                               |

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
   *  - `false` — disable. The HUD hides its "Solve" button; notes
   *              still save to disk so MCP-side consumers can act on
   *              them.
   *  - `'claude' | 'codex' | 'gemini'` — preset; everything defaults.
   *  - `LlmRouterConfig` — preset + overrides (model, timeoutMs,
   *              concurrency, env, extraArgs), or a fully custom
   *              invocation `{ command, args, promptVia }` (omit
   *              `preset` to opt out of preset defaults entirely).
   *
   * When the chosen CLI isn't on PATH the router degrades silently
   * to save-only and the HUD hides the Solve button — the user gets
   * a one-line install hint in the console.
   *
   * Default: `'claude'`.
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

<!-- auto-api:end -->
