---
title: '@llui/devmode-annotate'
description: 'Dev-only HUD that drops annotated notes from the running app into a shared on-disk notebook the LLM also reads and writes.'
---

# @llui/devmode-annotate

<!-- package-version:start -->

**Current package version:** `0.4.3`

<!-- package-version:end -->

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

### `bundleFilename()`

Default bundle filename: `llui-notes-<contentHash prefix>.zip`.

```typescript
function bundleFilename(manifest: BundleManifest): string
```

### `defaultSecretRedactor()`

An **opt-in** convenience redactor for the `state` channel: deep-walks
the captured `stateSnapshot` / message+console logs and masks common
secret shapes (Bearer tokens, `sk-`/`ghp_` keys, JWTs, emails) in
string values. A defense-in-depth default a host can plug in
(`redact: { state: defaultSecretRedactor() }`); it does NOT replace
authoring-time care — the host still owns what's sensitive. State is
JSON-serializable (no cycles) by the framework contract; a depth cap
guards pathological inputs.

```typescript
function defaultSecretRedactor(options: SecretRedactorOptions = {}): (body: NoteBody) => NoteBody
```

### `devServerStore()`

Build the dev-server-backed store rooted at `origin` (e.g. `location.origin`).
When a `taskCapabilityToken` is supplied (injected by `@llui/vite-plugin` when
the attention router is enabled), it's sent as the `x-llui-task-capability`
header so the middleware can trust an in-HUD task submission.

```typescript
function devServerStore(origin: string, taskCapabilityToken?: string): NotesStore
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

### `mountAnnotateHud()`

```typescript
function mountAnnotateHud(opts: MountAnnotateOptions = {}): AnnotateHudHandle
```

### `registerAnnotateEditor()`

Register an optional editor implementation. The returned disposer restores
the previous registration, which makes temporary host overrides safe.

```typescript
function registerAnnotateEditor(editor: AnnotateEditorRegistration): () => void
```

## Types

### `BakeFn`

```typescript
export type BakeFn = (
  screenshotBase64: string,
  annotations: Annotation[],
  geometry?: ScreenshotGeometry,
) => Promise<string>
```

### `HeadersInput`

Static headers, or a (sync/async) function called per request so tokens
can refresh.

```typescript
export type HeadersInput =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>)
```

## Interfaces

### `AnnotateEditorInstance`

```typescript
export interface AnnotateEditorInstance {
  getValue(): string
  setValue(value: string): void
  focus(): void
  dispose(): void
}
```

### `AnnotateEditorMountOptions`

Optional note-editor seam for the HUD.

Core owns the note value and keyboard behavior. An editor package owns only
the live editing surface, so the core package never needs to import its
implementation (or any of that implementation's dependencies).

```typescript
export interface AnnotateEditorMountOptions {
  host: HTMLElement
  initialValue: string
  placeholder: string
  onChange(value: string): void
}
```

### `AnnotateEditorRegistration`

```typescript
export interface AnnotateEditorRegistration {
  /** Human-readable help rendered below the editor surface. */
  hint: string
  /** Styles adopted into the HUD shadow root when isolation is enabled. */
  shadowCss?: string
  mount(options: AnnotateEditorMountOptions): AnnotateEditorInstance
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

### `BundleIdentity`

Who captured the notes (host-populated; omitted when unknown).

```typescript
export interface BundleIdentity {
  id?: string
  label?: string
  kind: 'human' | 'llm' | 'agent'
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

### `CaptureDefaults`

```typescript
export interface CaptureDefaults {
  /** Collect the verbose debug-telemetry body (state/message/effect dump). */
  debug: boolean
  /** Record user interactions (repro trace). */
  repro: boolean
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

### `ExportableStore`

A store that can produce its notebook as raw on-disk-format entries, for
export into a zip bundle. Browser stores implement this; the dev-server
store doesn't need to (its files already live on disk).

```typescript
export interface ExportableStore {
  exportSessions(sessionIds?: string[]): Promise<RawSession[]>
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

### `MountAnnotateOptions`

```typescript
export interface MountAnnotateOptions {
  origin?: string
  /** The notes transport. Defaults to `devServerStore(origin)` — the Vite
   *  dev-server endpoints. Inject a different adapter (IndexedDB, HTTP,
   *  export bundle) to run the HUD without a dev server.
   *
   *  `destroy()` calls `store.dispose()` on whatever it is given, so the HUD
   *  takes over the instance's out-of-heap resources: give it its OWN store
   *  rather than one the host also drives (see `NotesStore.dispose`). */
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
  /** Out-of-band capability token injected by `@llui/vite-plugin` (only when the
   *  attention router is enabled). The HUD echoes it as the `x-llui-task-capability`
   *  header on note POSTs so the dev-server middleware can distinguish a real in-HUD
   *  task submission (which may spawn a CLI agent) from a forged same-origin page
   *  POST. Without it, task submissions are created but never marked trusted, so
   *  they never spawn. Ignored when a custom `store` is supplied (the caller owns
   *  its transport/auth). */
  taskCapabilityToken?: string
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
  /** Registered editor stylesheet text adopted into the shadow root in isolate
   *  mode. Defaults to the active editor registration's `shadowCss`. Override
   *  to supply the CSS in environments where raw CSS imports can't resolve. */
  editorCss?: string
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

  /** Release everything the store holds outside the JS heap — object URLs,
   *  open connections — so a HUD mount/destroy cycle reclaims it. Idempotent.
   *
   *  The store stays USABLE (a later call lazily re-creates what it needs),
   *  but this is not a no-op for anything already handed out: it is the
   *  OWNER's teardown, and what it releases can belong to someone else.
   *  `indexedDbStore` revokes every object URL `screenshotUrl` returned, so an
   *  `<img>` the host is still displaying goes blank; `httpStore` closes every
   *  live `EventSource`, so ANOTHER subscriber's `onEvent` goes silently dead
   *  and nothing re-opens it.
   *
   *  This matters because `mountAnnotateHud` calls it from `destroy()` on the
   *  store it was GIVEN — the HUD cannot leave an injected store undisposed
   *  without re-opening the leak this exists to close (an inline
   *  `installAnnotateHud({ store: indexedDbStore() })` keeps no reference the
   *  host could dispose, and object URLs are not garbage-collected). So a host
   *  that also uses the store from its own code should construct a SECOND
   *  instance for the HUD; they are cheap and share the backing store.
   *
   *  Required on the port rather than optional so the compiler names it for
   *  every adapter (a store with nothing to release implements a no-op) —
   *  though that is a type-level guard only: a `as unknown as NotesStore` test
   *  fake still reaches destroy() and throws there. */
  dispose(): void
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

### `NoteUpdate`

A mutable patch to an existing note (PATCH).

```typescript
export interface NoteUpdate {
  prose?: string
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

### `ScreenshotGeometry`

Geometry threaded from the capture into the annotation baker so viewport
(CSS-px, scroll-relative) annotation coordinates land correctly on the
full-document, DPR-scaled screenshot raster.

```typescript
export interface ScreenshotGeometry {
  /** Device pixel ratio the screenshot was captured at (frontmatter viewport.dpr). */
  dpr: number
  /** Viewport scroll offset (CSS px) at capture time. */
  scrollX: number
  scrollY: number
}
```

### `SecretRedactorOptions`

```typescript
export interface SecretRedactorOptions {
  /** Extra regexes whose matches are masked (added to the built-ins). */
  patterns?: readonly RegExp[]
  /** Replacement token. Default `'[redacted]'`. */
  mask?: string
  /** Max recursion depth for the state walk. Default 12. */
  maxDepth?: number
}
```

### `SessionSummary`

One session as returned by the session list.

```typescript
export interface SessionSummary {
  id: string
  noteCount: number
  startedAt?: string
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

## Constants

### `NOTE_SCHEMA_VERSION`

On-disk note-format schema version. Stamped into export bundles and
checked on dev import so a producer and consumer never silently disagree.
v2 = the current "body under a `body:` frontmatter key" format (v1 was the
legacy trailing-```json fence, still readable by `parseNote`).

```typescript
const NOTE_SCHEMA_VERSION
```

## Public Entry Points

### `@llui/devmode-annotate/note-types`

#### Types

##### `Annotation` from `@llui/devmode-annotate/note-types`

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

##### `Author` from `@llui/devmode-annotate/note-types`

```typescript
export type Author = 'human' | 'llm'
```

##### `CaptureLevel` from `@llui/devmode-annotate/note-types`

```typescript
export type CaptureLevel = 'standard' | 'verbose'
```

##### `LogLevel` from `@llui/devmode-annotate/note-types`

```typescript
export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'
```

##### `NoteIntent` from `@llui/devmode-annotate/note-types`

```typescript
export type NoteIntent = 'task' | 'note'
```

##### `NoteKind` from `@llui/devmode-annotate/note-types`

```typescript
export type NoteKind = 'rect' | 'element' | 'text' | 'capture' | 'reply'
```

##### `NoteStatus` from `@llui/devmode-annotate/note-types`

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

##### `ReproEvent` from `@llui/devmode-annotate/note-types`

```typescript
export type ReproEvent =
  | {
      type: 'click'
      t: number
      selector: string
    }
  | {
      type: 'input'
      t: number
      selector: string
      value?: string
      redacted?: boolean
    }
  | {
      type: 'keydown'
      t: number
      key: string
      mods?: string
    }
  | {
      type: 'route'
      t: number
      pathname: string
    }
```

##### `ServerEvent` from `@llui/devmode-annotate/note-types`

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

##### `SseRole` from `@llui/devmode-annotate/note-types`

```typescript
export type SseRole = 'hud' | 'mcp' | 'viewer'
```

#### Interfaces

##### `AgentSchemaSummary` from `@llui/devmode-annotate/note-types`

```typescript
export interface AgentSchemaSummary {
  msg: string
  fields: Record<string, string>
}
```

##### `CaptureRequestPayload` from `@llui/devmode-annotate/note-types`

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

##### `CaptureRequestResponse` from `@llui/devmode-annotate/note-types`

```typescript
export interface CaptureRequestResponse {
  requestId: string
  status: 'fulfilled' | 'timeout' | 'no-client'
  note?: CreateNoteResponse
}
```

##### `ComponentMetaRef` from `@llui/devmode-annotate/note-types`

```typescript
export interface ComponentMetaRef {
  file: string
  line: number
  name: string
}
```

##### `ConsoleLogEntry` from `@llui/devmode-annotate/note-types`

```typescript
export interface ConsoleLogEntry {
  ts: string
  level: LogLevel
  text: string
}
```

##### `CreateNoteRequest` from `@llui/devmode-annotate/note-types`

```typescript
export interface CreateNoteRequest {
  body: string
  frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'>
  noteBody: NoteBody
  screenshot?: string
}
```

##### `CreateNoteResponse` from `@llui/devmode-annotate/note-types`

```typescript
export interface CreateNoteResponse {
  id: string
  filename: string
  path: string
  sessionId: string
}
```

##### `CurrentSessionResponse` from `@llui/devmode-annotate/note-types`

```typescript
export interface CurrentSessionResponse {
  sessionId: string
  startedAt: string
  notesDir: string
}
```

##### `DirtyTraceEntry` from `@llui/devmode-annotate/note-types`

```typescript
export interface DirtyTraceEntry {
  component: string
  pathsTracked: string[]
  mask: number
  maskHi?: number
  lastFlippedBits: string[]
}
```

##### `ListNotesError` from `@llui/devmode-annotate/note-types`

A note file that matched the canonical filename but could not be parsed
(corrupt frontmatter, torn write, hand-edited). Surfaced rather than
silently dropped so a broken note is visible instead of vanishing.

```typescript
export interface ListNotesError {
  filename: string
  message: string
}
```

##### `ListNotesQuery` from `@llui/devmode-annotate/note-types`

```typescript
export interface ListNotesQuery {
  sessionId?: string
  author?: Author
  kind?: NoteKind | NoteKind[]
  since?: string
  limit?: number
}
```

##### `ListNotesResponse` from `@llui/devmode-annotate/note-types`

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

##### `MessageLogEntry` from `@llui/devmode-annotate/note-types`

```typescript
export interface MessageLogEntry {
  ts: string
  component: string
  msg: unknown
}
```

##### `NoteBody` from `@llui/devmode-annotate/note-types`

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

##### `NoteFrontmatter` from `@llui/devmode-annotate/note-types`

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

##### `NoteRect` from `@llui/devmode-annotate/note-types`

```typescript
export interface NoteRect {
  x: number
  y: number
  w: number
  h: number
}
```

##### `NoteSummary` from `@llui/devmode-annotate/note-types`

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

##### `PendingEffectEntry` from `@llui/devmode-annotate/note-types`

```typescript
export interface PendingEffectEntry {
  id: string
  component: string
  effect: unknown
  sinceMs: number
}
```

##### `PendingMessage` from `@llui/devmode-annotate/note-types`

```typescript
export interface PendingMessage {
  component: string
  msg: unknown
}
```

##### `ProposedDiff` from `@llui/devmode-annotate/note-types`

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

##### `RecentEffectEntry` from `@llui/devmode-annotate/note-types`

```typescript
export interface RecentEffectEntry {
  ts: string
  component: string
  effect: unknown
  outcome: 'ok' | 'error' | 'cancelled'
  error?: string
}
```

##### `RuntimeErrorEntry` from `@llui/devmode-annotate/note-types`

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

##### `SourceMapEntry` from `@llui/devmode-annotate/note-types`

```typescript
export interface SourceMapEntry {
  selector: string
  file: string
  line: number
  componentPath: string[]
}
```

##### `StatusTransition` from `@llui/devmode-annotate/note-types`

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

##### `StructuralSnapshot` from `@llui/devmode-annotate/note-types`

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

##### `VerboseNoteBody` from `@llui/devmode-annotate/note-types`

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

### `@llui/devmode-annotate/note-format`

#### Functions

##### `buildQueue()` from `@llui/devmode-annotate/note-format`

Materialize per-note current status from a flat transition log, newest
touched first. One entry per note id that has ever transitioned;
optionally filtered by status.

```typescript
export declare function buildQueue(
  transitions: readonly StatusTransition[],
  filter?: {
    status?: NoteStatus | NoteStatus[]
  },
): QueueEntry[]
```

##### `currentStatusFromHistory()` from `@llui/devmode-annotate/note-format`

Current status for a note: last `to`, or null when it has no transitions.

```typescript
export declare function currentStatusFromHistory(
  history: readonly StatusTransition[],
): NoteStatus | null
```

##### `defaultSessionName()` from `@llui/devmode-annotate/note-format`

Default UTC session folder name: `session-YYYY-MM-DD-HHMM`.

```typescript
export declare function defaultSessionName(d: Date): string
```

##### `deriveFilename()` from `@llui/devmode-annotate/note-format`

```typescript
export declare function deriveFilename(
  id: string,
  author: Author,
  kind: NoteKind,
  slug: string,
): string
```

##### `deriveSlug()` from `@llui/devmode-annotate/note-format`

```typescript
export declare function deriveSlug(prose: string): string
```

##### `nextId()` from `@llui/devmode-annotate/note-format`

The next id given the ids already present (handles gaps): padId(max+1).

```typescript
export declare function nextId(existingIds: readonly number[]): string
```

##### `padId()` from `@llui/devmode-annotate/note-format`

3-digit zero-padded session-local sequence id (001, 002, … then 1000+).

```typescript
export declare function padId(n: number): string
```

##### `parseFilename()` from `@llui/devmode-annotate/note-format`

```typescript
export declare function parseFilename(filename: string): ParsedFilename | null
```

##### `preview()` from `@llui/devmode-annotate/note-format`

One-line preview of prose for note summaries.

```typescript
export declare function preview(prose: string, max?: number): string
```

#### Interfaces

##### `ParsedFilename` from `@llui/devmode-annotate/note-format`

```typescript
export interface ParsedFilename {
  id: string
  idNum: number
  author: Author
  kind: NoteKind
  slug: string
}
```

##### `QueueEntry` from `@llui/devmode-annotate/note-format`

```typescript
export interface QueueEntry {
  noteId: string
  status: NoteStatus
  transitions: StatusTransition[]
}
```

#### Constants

##### `NOTE_FILENAME_RE` from `@llui/devmode-annotate/note-format`

```typescript
const NOTE_FILENAME_RE: RegExp
```

##### `NOTE_SCHEMA_VERSION` from `@llui/devmode-annotate/note-format`

On-disk note-format schema version. Stamped into export bundles and
checked on dev import so a producer and consumer never silently disagree.
v2 = the current "body under a `body:` frontmatter key" format (v1 was the
legacy trailing-```json fence, still readable by `parseNote`).

```typescript
const NOTE_SCHEMA_VERSION
```

### `@llui/devmode-annotate/note-serialize`

#### Functions

##### `parseNote()` from `@llui/devmode-annotate/note-serialize`

```typescript
export declare function parseNote(markdown: string): SerializedNote
```

##### `serializeNote()` from `@llui/devmode-annotate/note-serialize`

```typescript
export declare function serializeNote(note: SerializedNote): string
```

#### Interfaces

##### `SerializedNote` from `@llui/devmode-annotate/note-serialize`

```typescript
export interface SerializedNote {
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
}
```

### `@llui/devmode-annotate/install`

#### Functions

##### `installAnnotateHud()` from `@llui/devmode-annotate/install`

Install the HUD lazily behind an activation trigger. Intended for live
apps: the host calls this (behind its own authorization), and the HUD code
only loads when a user activates it. Defaults to `allowProduction: true`
since the host is opting in deliberately.

```typescript
function installAnnotateHud(opts: InstallAnnotateOptions = {}): AnnotateHudInstaller
```

#### Interfaces

##### `AnnotateHudInstaller` from `@llui/devmode-annotate/install`

```typescript
export interface AnnotateHudInstaller {
  /** Lazily import + mount the HUD (idempotent — repeat calls return the same
   *  handle). Resolves to the live handle. */
  activate(): Promise<AnnotateHudHandle>
  /** Remove the bootstrap trigger listener. Does not unmount a HUD that has
   *  already been activated. */
  dispose(): void
}
```

##### `InstallAnnotateOptions` from `@llui/devmode-annotate/install`

```typescript
export interface InstallAnnotateOptions extends MountAnnotateOptions {
  /** Register the Cmd/Ctrl+Shift+A keyboard trigger that lazily loads + opens
   *  the HUD. Default true. Set false to drive activation yourself via
   *  `activate()`. */
  trigger?: boolean
}
```

### `@llui/devmode-annotate/editor`

#### Functions

##### `registerAnnotateEditor()` from `@llui/devmode-annotate/editor`

Register an optional editor implementation. The returned disposer restores
the previous registration, which makes temporary host overrides safe.

```typescript
function registerAnnotateEditor(editor: AnnotateEditorRegistration): () => void
```

##### `registeredAnnotateEditor()` from `@llui/devmode-annotate/editor`

The editor registration captured by the next HUD mount, if any.

```typescript
function registeredAnnotateEditor(): AnnotateEditorRegistration | null
```

#### Interfaces

##### `AnnotateEditorInstance` from `@llui/devmode-annotate/editor`

```typescript
export interface AnnotateEditorInstance {
  getValue(): string
  setValue(value: string): void
  focus(): void
  dispose(): void
}
```

##### `AnnotateEditorMountOptions` from `@llui/devmode-annotate/editor`

Optional note-editor seam for the HUD.

Core owns the note value and keyboard behavior. An editor package owns only
the live editing surface, so the core package never needs to import its
implementation (or any of that implementation's dependencies).

```typescript
export interface AnnotateEditorMountOptions {
  host: HTMLElement
  initialValue: string
  placeholder: string
  onChange(value: string): void
}
```

##### `AnnotateEditorRegistration` from `@llui/devmode-annotate/editor`

```typescript
export interface AnnotateEditorRegistration {
  /** Human-readable help rendered below the editor surface. */
  hint: string
  /** Styles adopted into the HUD shadow root when isolation is enabled. */
  shadowCss?: string
  mount(options: AnnotateEditorMountOptions): AnnotateEditorInstance
}
```

### `@llui/devmode-annotate/stores`

#### Functions

##### `devServerStore()` from `@llui/devmode-annotate/stores`

Build the dev-server-backed store rooted at `origin` (e.g. `location.origin`).
When a `taskCapabilityToken` is supplied (injected by `@llui/vite-plugin` when
the attention router is enabled), it's sent as the `x-llui-task-capability`
header so the middleware can trust an in-HUD task submission.

```typescript
function devServerStore(origin: string, taskCapabilityToken?: string): NotesStore
```

##### `httpStore()` from `@llui/devmode-annotate/stores`

A NotesStore that talks to a host-provided HTTP backend. Use in production
when a team wants centralized capture instead of manual export/import. The
backend must speak the notebook wire protocol (the same shapes the dev
server serves under `/_llui`).

```typescript
function httpStore(opts: HttpStoreOptions): NotesStore
```

##### `indexedDbStore()` from `@llui/devmode-annotate/stores`

Build a browser-local NotesStore backed by IndexedDB. No dev server
required; the HUD captures, persists, and browses entirely client-side.

```typescript
function indexedDbStore(opts: IndexedDbStoreOptions = {}): NotesStore & ExportableStore
```

#### Types

##### `HeadersInput` from `@llui/devmode-annotate/stores`

Static headers, or a (sync/async) function called per request so tokens
can refresh.

```typescript
export type HeadersInput =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>)
```

#### Interfaces

##### `EventSubscription` from `@llui/devmode-annotate/stores`

Live-event subscription parameters.

```typescript
export interface EventSubscription {
  role: SseRole
  onEvent: (event: ServerEvent) => void
  onError?: (err: unknown) => void
}
```

##### `ExportableStore` from `@llui/devmode-annotate/stores`

A store that can produce its notebook as raw on-disk-format entries, for
export into a zip bundle. Browser stores implement this; the dev-server
store doesn't need to (its files already live on disk).

```typescript
export interface ExportableStore {
  exportSessions(sessionIds?: string[]): Promise<RawSession[]>
}
```

##### `FullNote` from `@llui/devmode-annotate/stores`

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

##### `HttpStoreOptions` from `@llui/devmode-annotate/stores`

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

##### `IndexedDbStoreOptions` from `@llui/devmode-annotate/stores`

```typescript
export interface IndexedDbStoreOptions {
  /** IndexedDB database name. Default `llui-devmode-annotate`. */
  dbName?: string
  /** Clock override (tests / deterministic runs). Default `() => new Date()`. */
  now?: () => Date
}
```

##### `NotesStore` from `@llui/devmode-annotate/stores`

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

  /** Release everything the store holds outside the JS heap — object URLs,
   *  open connections — so a HUD mount/destroy cycle reclaims it. Idempotent.
   *
   *  The store stays USABLE (a later call lazily re-creates what it needs),
   *  but this is not a no-op for anything already handed out: it is the
   *  OWNER's teardown, and what it releases can belong to someone else.
   *  `indexedDbStore` revokes every object URL `screenshotUrl` returned, so an
   *  `<img>` the host is still displaying goes blank; `httpStore` closes every
   *  live `EventSource`, so ANOTHER subscriber's `onEvent` goes silently dead
   *  and nothing re-opens it.
   *
   *  This matters because `mountAnnotateHud` calls it from `destroy()` on the
   *  store it was GIVEN — the HUD cannot leave an injected store undisposed
   *  without re-opening the leak this exists to close (an inline
   *  `installAnnotateHud({ store: indexedDbStore() })` keeps no reference the
   *  host could dispose, and object URLs are not garbage-collected). So a host
   *  that also uses the store from its own code should construct a SECOND
   *  instance for the HUD; they are cheap and share the backing store.
   *
   *  Required on the port rather than optional so the compiler names it for
   *  every adapter (a store with nothing to release implements a no-op) —
   *  though that is a type-level guard only: a `as unknown as NotesStore` test
   *  fake still reaches destroy() and throws there. */
  dispose(): void
}
```

##### `NoteStatusResponse` from `@llui/devmode-annotate/stores`

Status sidecar for a single note: its current status + transition log.

```typescript
export interface NoteStatusResponse {
  current: NoteStatus | null
  history: StatusTransition[]
}
```

##### `NoteUpdate` from `@llui/devmode-annotate/stores`

A mutable patch to an existing note (PATCH).

```typescript
export interface NoteUpdate {
  prose?: string
}
```

##### `QueueEntry` from `@llui/devmode-annotate/stores`

A note's place in the task queue.

```typescript
export interface QueueEntry {
  noteId: string
  status: NoteStatus
}
```

##### `QueueResponse` from `@llui/devmode-annotate/stores`

```typescript
export interface QueueResponse {
  queue: QueueEntry[]
}
```

##### `RawNote` from `@llui/devmode-annotate/stores`

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

##### `RawSession` from `@llui/devmode-annotate/stores`

One session in raw export form.

```typescript
export interface RawSession {
  id: string
  notes: RawNote[]
  /** `status.jsonl` content (one JSON transition per line; '' when empty). */
  statusJsonl: string
}
```

##### `SessionSummary` from `@llui/devmode-annotate/stores`

One session as returned by the session list.

```typescript
export interface SessionSummary {
  id: string
  noteCount: number
  startedAt?: string
}
```

##### `StatusUpdate` from `@llui/devmode-annotate/stores`

A status transition the HUD requests (POST status).

```typescript
export interface StatusUpdate {
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}
```

#### Constants

##### `SCREENSHOT_URL_CACHE_LIMIT` from `@llui/devmode-annotate/stores`

How many screenshot object URLs the store keeps alive at once. Each one
pins a decoded PNG Blob, and only the open detail view displays a
screenshot at a time — the cache exists so revisiting a recently browsed
note is instant, not so the whole notebook stays decoded in memory.

```typescript
const SCREENSHOT_URL_CACHE_LIMIT
```

<!-- auto-api:end -->

## Related

- [`@llui/vite-plugin`](/api/vite-plugin) — the dev-server middleware that backs every HUD HTTP call. See `devmodeAnnotate` config.
- [`@llui/mcp`](/api/mcp) — the LLM-facing side of the same notebook.
- Proposal: [`docs/proposals/devmode-annotate/`](https://github.com/fponticelli/llui/tree/main/docs/proposals/devmode-annotate) — full on-disk format spec, middleware contract, MCP surface, runtime-hook plan, and task-mode design.
