---
title: '@llui/devmode-annotate'
description: 'Dev-only HUD that drops annotated notes from the running app into a shared on-disk notebook the LLM also reads and writes.'
---

# @llui/devmode-annotate

Browser-side HUD that connects the running LLui app to a shared on-disk notebook the LLM can also read and write. Floating button → click to draft a text note, or drag to draw a rectangle around the thing you want the LLM to look at → submit. The note lands as a `.md` file on disk under `<your-app>/.llui/notes/session-<id>/` with a screenshot, the URL, the route, the component path under the cursor, scope state, recent messages, dirty trace, and (opt-in) verbose runtime telemetry.

The LLM consumes the same directory via [`@llui/mcp`](/api/mcp)'s `llui_list_notes` / `llui_read_note` / `llui_capture` tools and can request its own captures back through the HUD via the dev-server's SSE channel.

```bash
pnpm add -D @llui/devmode-annotate
```

```ts
// app entry — dev-only mount
import { mountAnnotateHud } from '@llui/devmode-annotate'

if (import.meta.env.DEV) {
  mountAnnotateHud()
}
```

That's the entire setup. The HUD only mounts when the dev-server has the [`devmodeAnnotate`](/api/vite-plugin) middleware registered (on by default in dev mode for the LLui Vite plugin). Production builds tree-shake the import.

## How the pieces fit together

```
running app           dev-server               LLM
─────────────         ──────────────────       ───────────────

@llui/devmode-       @llui/vite-plugin        @llui/mcp
annotate (HUD)  ←──→ notes middleware   ←──→  notes tools
                     (/_llui/*)               (llui_capture,
                          │                    llui_list_notes,
                          ▼                    llui_read_note,
                     .llui/notes/              llui_note_*)
                     session-<id>/
                       001-human-…md
                       001-human-…png
                       002-llm-reply-…md
                       …
```

- **`@llui/devmode-annotate`** — this package. The HUD: floating button, draft modal, rect overlay, screenshot capture, programmatic `submit()` API.
- **`@llui/vite-plugin`** — owns the notes middleware mounted at `/_llui/*`. Same dev-server already running your app; nothing extra to boot. See [`devmodeAnnotate`](/api/vite-plugin) config.
- **`@llui/mcp`** — exposes the notebook to the LLM as MCP resources and tools. The LLM can request a capture (HUD draws it), or read notes the human dropped. See [`notesRoot`](/api/mcp).

The notebook itself outlives any of them — the on-disk format is the contract, the three clients all read and write the same files. Full design + on-disk format spec: [`docs/proposals/devmode-annotate/`](https://github.com/fponticelli/llui/tree/main/docs/proposals/devmode-annotate).

## When to use it

Use this when you'd otherwise screenshot + circle + paste into a chat. The HUD captures all the things that flatten away in that workflow — URL, route, component path under the cursor, scope state, message log, in-flight effects, dirty trace, source-position map. The LLM reads a rich artifact, not a flattened image.

Skip it for production telemetry, error reporting, or anything end users would see — this is a dev-mode developer surface, not a user-facing feedback widget.

## Note intents: `note` vs `task`

Each submission carries an `intent`:

- **`task`** (default for HUD button) — an actionable ask. Lands in the LLM's queue and shows up as a "Solve" affordance in subsequent notes. The optional attention router (see `05-task-mode.md` in the proposal) auto-dispatches these to a headless Claude Code process and streams status (`open` → `working` → `proposed` → `accepted`) back into the HUD.
- **`note`** — an FYI / observation. Doesn't enter the task queue; the LLM consumes it as ambient context. Pass `intent: 'note'` to `submit()` for these.

Use `setIntent()` to flip the floating-button default.

## Capture levels

Every note carries a screenshot + the standard telemetry. Pass `captureLevel: 'verbose'` to additionally include the full binding array, scope tree, and recent message ring buffer. Verbose captures grow notes by 10–100× — useful for "I don't know what's wrong" investigations, overkill for "this button is the wrong color."

```ts
hud.submit('this list re-renders on every keystroke — why?', {
  captureLevel: 'verbose',
  intent: 'task',
})
```

## LLM-initiated captures

When the LLM (via `@llui/mcp`'s `llui_capture` tool) asks for a fresh snapshot, the dev-server fans the request out via SSE to every connected HUD. The HUD that owns the active page handles it, captures, posts the note back, and the LLM's tool call resolves with the note's metadata. No human in the loop required — the LLM can poke at the running app the same way the developer can.

When no HUD is connected (e.g., the app is closed in the browser), `@llui/mcp` falls back to a headless Playwright capture against the dev-server URL. The LLM gets a screenshot either way.

## API

<!-- auto-api:start -->

## Functions

### `devServerStore()`

Build the dev-server-backed store rooted at `origin` (e.g. `location.origin`).

```typescript
function devServerStore(origin: string): NotesStore
```

### `httpStore()`

A NotesStore that talks to a host-provided HTTP backend. Use in production
when a team wants centralized capture instead of manual export/import. The
backend must speak the notebook wire protocol (the same shapes the dev
server serves under `/_llui`).

```typescript
function httpStore(opts: HttpStoreOptions): NotesStore
```

### `indexedDbStore()`

Build a browser-local NotesStore backed by IndexedDB. No dev server
required; the HUD captures, persists, and browses entirely client-side.

```typescript
function indexedDbStore(opts: IndexedDbStoreOptions = {}): NotesStore & ExportableStore
```

### `exportBundle()`

Build an export bundle from any store that can produce raw sessions.
Returns the zip as a Blob (for download), the parsed manifest, and the
raw bytes.

```typescript
function exportBundle(
  store: ExportableStore,
  opts: ExportBundleOptions = {},
): Promise<ExportBundleResult>
```

### `bundleFilename()`

Default bundle filename: `llui-notes-<contentHash prefix>.zip`.

```typescript
function bundleFilename(manifest: BundleManifest): string
```

### `mountAnnotateHud()`

```typescript
function mountAnnotateHud(opts: MountAnnotateOptions = {}): AnnotateHudHandle
```

## Types

### `HeadersInput`

Static headers, or a (sync/async) function called per request so tokens
can refresh.

```typescript
export type HeadersInput =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>)
```

### `BakeFn`

```typescript
export type BakeFn = (screenshotBase64: string, annotations: Annotation[]) => Promise<string>
```

## Interfaces

### `SessionSummary`

One session as returned by the session list.

```typescript
export interface SessionSummary {
  id: string
  noteCount: number
  startedAt?: string
}
```

### `NoteStatusResponse`

Status sidecar for a single note: its current status + transition log.

```typescript
export interface NoteStatusResponse {
  current: NoteStatus | null
  history: StatusTransition[]
}
```

### `QueueEntry`

A note's place in the task queue.

```typescript
export interface QueueEntry {
  noteId: string
  status: NoteStatus
}
```

### `QueueResponse`

```typescript
export interface QueueResponse {
  queue: QueueEntry[]
}
```

### `FullNote`

A note fetched in full (the `format=json` shape). Frontmatter/body are
intentionally loose — consumers narrow what they read. Concrete
`NoteFrontmatter`/`NoteBody` values assign here (they carry these fields
and more); the dev-server adapter also fills it from raw server JSON.

```typescript
export interface FullNote {
  frontmatter: {
    kind: string
    author: string
    intent?: string
    screenshot?: string | null
  }
  prose: string
  body?: { repro?: unknown[] }
}
```

### `StatusUpdate`

A status transition the HUD requests (POST status).

```typescript
export interface StatusUpdate {
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}
```

### `NoteUpdate`

A mutable patch to an existing note (PATCH).

```typescript
export interface NoteUpdate {
  prose?: string
}
```

### `RawNote`

One note in raw export form: its serialized `.md` plus optional screenshot.

```typescript
export interface RawNote {
  /** The `.md` filename (canonical `{id}-{author}-{kind}-{slug}.md`). */
  filename: string
  /** Serialized note markdown (YAML frontmatter + prose). */
  markdown: string
  /** Screenshot bytes (PNG), or null when the note has none. */
  screenshot: Uint8Array | null
}
```

### `RawSession`

One session in raw export form.

```typescript
export interface RawSession {
  id: string
  notes: RawNote[]
  /** `status.jsonl` content (one JSON transition per line; '' when empty). */
  statusJsonl: string
}
```

### `ExportableStore`

A store that can produce its notebook as raw on-disk-format entries, for
export into a zip bundle. Browser stores implement this; the dev-server
store doesn't need to (its files already live on disk).

```typescript
export interface ExportableStore {
  exportSessions(sessionIds?: string[]): Promise<RawSession[]>
}
```

### `EventSubscription`

Live-event subscription parameters.

```typescript
export interface EventSubscription {
  role: SseRole
  onEvent: (event: ServerEvent) => void
  onError?: (err: unknown) => void
}
```

### `NotesStore`

The transport the HUD reads and writes through. Methods reject on
failure; callers keep their own try/catch and best-effort semantics.

```typescript
export interface NotesStore {
  /** Create a note (text/rect/capture/reply, or a task). */
  createNote(req: CreateNoteRequest): Promise<CreateNoteResponse>

  /** List all sessions, newest first. */
  listSessions(): Promise<SessionSummary[]>

  /** The session the store is currently writing into. */
  currentSession(): Promise<CurrentSessionResponse>

  /** Summaries of the notes in a session. */
  listNotes(query: ListNotesQuery): Promise<ListNotesResponse>

  /** A single note in full, or null if it can't be read. */
  readNote(id: string, sessionId: string): Promise<FullNote | null>

  /** A note's current status + transition history. */
  getStatus(id: string, sessionId: string): Promise<NoteStatusResponse>

  /** The task queue for a session. */
  getQueue(sessionId: string): Promise<QueueResponse>

  /** Delete a note. */
  deleteNote(id: string, sessionId: string): Promise<void>

  /** Patch a note (currently prose only). */
  updateNote(id: string, sessionId: string, update: NoteUpdate): Promise<void>

  /** Request a status transition for a note. */
  postStatus(id: string, sessionId: string, update: StatusUpdate): Promise<void>

  /** A URL usable directly as an `<img src>` for a note's screenshot.
   *  `screenshotRef` is the frontmatter `screenshot` value. Synchronous so
   *  it can be read inside a reactive view binding. */
  screenshotUrl(id: string, screenshotRef: string): string

  /** Subscribe to live notebook events. Returns an unsubscribe function.
   *  A noop subscription (returning a noop unsubscribe) is valid when the
   *  store has no live channel. */
  subscribeEvents(sub: EventSubscription): () => void
}
```

### `HttpStoreOptions`

```typescript
export interface HttpStoreOptions {
  /** Base URL the host's notebook backend lives under, no trailing slash. */
  baseUrl: string
  /** Headers injected on every request (e.g. an auth token). Never bake
   *  credentials into the bundle — supply them here at mount time. */
  headers?: HeadersInput
  /** Override fetch (tests / custom transport). */
  fetch?: typeof fetch
}
```

### `IndexedDbStoreOptions`

```typescript
export interface IndexedDbStoreOptions {
  /** IndexedDB database name. Default `llui-devmode-annotate`. */
  dbName?: string
  /** Clock override (tests / deterministic runs). Default `() => new Date()`. */
  now?: () => Date
}
```

### `BundleIdentity`

Who captured the notes (host-populated; omitted when unknown).

```typescript
export interface BundleIdentity {
  id?: string
  label?: string
  kind: 'human' | 'llm' | 'agent'
}
```

### `BundleAppProvenance`

Capture-environment provenance (host-populated; omitted when unknown).

```typescript
export interface BundleAppProvenance {
  version?: string
  buildId?: string
  releaseChannel?: string
  url?: string
}
```

### `BundleManifest`

```typescript
export interface BundleManifest {
  /** On-disk note-format schema version (see NOTE_SCHEMA_VERSION). */
  schemaVersion: number
  /** Host-stamped export time (ISO). */
  exportedAt: string
  /** The sessions included, sorted. */
  sessions: string[]
  /** Total `.md` notes across all sessions. */
  noteCount: number
  /** SHA-256 hex over every file entry (sorted by path), excluding the
   *  manifest itself. Drives idempotent import + integrity checks. */
  contentHash: string
  exportedBy?: BundleIdentity
  app?: BundleAppProvenance
}
```

### `ExportBundleOptions`

```typescript
export interface ExportBundleOptions {
  /** Limit to these sessions. Default: every session in the store. */
  sessionIds?: string[]
  /** Capture identity recorded in the manifest. */
  exportedBy?: BundleIdentity
  /** App/environment provenance recorded in the manifest. */
  app?: BundleAppProvenance
  /** Clock override (tests / deterministic runs). */
  now?: () => Date
}
```

### `ExportBundleResult`

```typescript
export interface ExportBundleResult {
  blob: Blob
  manifest: BundleManifest
  /** The raw zip bytes (same content as `blob`), handy for tests/Node. */
  bytes: Uint8Array
}
```

### `RedactHooks`

Per-channel sanitize hooks, each run just before a capture is persisted.
Separate channels so a host can drop only the risky one rather than
all-or-nothing.

```typescript
export interface RedactHooks {
  /** Transform the debug-telemetry body (per-component state snapshot,
   *  message/effect logs, dirty trace, …). Return a replacement, e.g.
   *  `{}` to drop it entirely or a copy with `stateSnapshot` removed. */
  state?: (body: NoteBody) => NoteBody
  /** Transform recorded interactions (e.g. mask typed input values). Return
   *  `[]` to drop the repro trace. */
  repro?: (events: ReproEvent[]) => ReproEvent[]
  /** Transform the screenshot (base64 PNG, no `data:` prefix) — e.g. mask
   *  regions. Return `null` to drop the screenshot entirely. */
  screenshot?: (pngBase64: string) => string | null
}
```

### `CaptureDefaults`

```typescript
export interface CaptureDefaults {
  /** Collect the verbose debug-telemetry body (state/message/effect dump). */
  debug: boolean
  /** Record user interactions (repro trace). */
  repro: boolean
}
```

### `MountAnnotateOptions`

```typescript
export interface MountAnnotateOptions {
  origin?: string
  /** The notes transport. Defaults to `devServerStore(origin)` — the Vite
   *  dev-server endpoints. Inject a different adapter (IndexedDB, HTTP,
   *  export bundle) to run the HUD without a dev server. */
  store?: NotesStore
  /** Mount in a production build. By default the HUD only mounts under the
   *  dev server (`import.meta.env.DEV`); set this when a live app deliberately
   *  ships it (typically via `installAnnotateHud`, behind the host's own
   *  authorization). */
  allowProduction?: boolean
  llui?: { runtime: string; compiler: string }
  hidden?: boolean
  capture?: CaptureFn
  bake?: BakeFn
  subscribeEvents?: boolean
  rehydrate?: boolean
  solveEnabled?: boolean
  autoCaptureOnError?: boolean
  repro?: boolean
  elementPick?: boolean
  /** Per-channel redaction hooks (state / repro / screenshot), run before a
   *  capture is persisted. The host owns the privacy policy; these are the
   *  seams to enforce it. */
  redact?: RedactHooks
  /** Collect the verbose debug-telemetry body (state/message/effect dump).
   *  Defaults: on under the dev server, OFF in production. */
  captureDebug?: boolean
  /** Mount the HUD chrome inside an open shadow root with isolated styles
   *  (constructable `adoptedStyleSheets`, falling back to a shadow `<style>`).
   *  Gives bidirectional style isolation from the host app and avoids the
   *  `style-src 'unsafe-inline'` CSP rule. Default false (light DOM, the dev
   *  default); `installAnnotateHud` turns it on for production. */
  isolate?: boolean
}
```

### `AnnotateHudHandle`

```typescript
export interface AnnotateHudHandle {
  open(): void
  close(): void
  destroy(): void
  /** Programmatically set the compose draft (Markdown). Flows into the embedded
   * editor like a restored draft. */
  setProse(text: string): void
  submit(
    prose: string,
    opts?: {
      captureLevel?: CaptureLevel
      annotations?: Annotation[]
      screenshot?: string
      intent?: NoteIntent
      resume?: boolean
      chainName?: string
    },
  ): Promise<CreateNoteResponse>
  drawRect(): Promise<NoteRect | null>
  handleCaptureRequest(
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse>
  setIntent(intent: NoteIntent): void
  replayRepro(
    events: ReproEvent[],
    options?: { speed?: number; maxStepMs?: number; abortOnMissing?: boolean },
  ): Promise<{ applied: number; skipped: Array<{ event: ReproEvent; reason: string }> }>
  /** Export the notebook as a downloadable `.zip` bundle and trigger a
   *  browser download. Resolves to the bundle manifest, or `null` when the
   *  active store can't export (e.g. the dev-server store). */
  exportBundle(): Promise<BundleManifest | null>
}
```

## Constants

### `NOTE_SCHEMA_VERSION`

On-disk note-format schema version. Stamped into export bundles and
checked on dev import so a producer and consumer never silently disagree.
v2 = the current "body under a `body:` frontmatter key" format (v1 was the
legacy trailing-```json fence, still readable by `parseNote`).

```typescript
const NOTE_SCHEMA_VERSION
```

<!-- auto-api:end -->

## Related

- [`@llui/vite-plugin`](/api/vite-plugin) — the dev-server middleware that backs every HUD HTTP call. See `devmodeAnnotate` config.
- [`@llui/mcp`](/api/mcp) — the LLM-facing side of the same notebook.
- Proposal: [`docs/proposals/devmode-annotate/`](https://github.com/fponticelli/llui/tree/main/docs/proposals/devmode-annotate) — full on-disk format spec, middleware contract, MCP surface, runtime-hook plan, and task-mode design.
