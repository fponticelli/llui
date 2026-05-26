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

### `mountAnnotateHud()`

```typescript
function mountAnnotateHud(opts: MountAnnotateOptions = {}): AnnotateHudHandle
```

## Types

### `BakeFn`

```typescript
export type BakeFn = (screenshotBase64: string, annotations: Annotation[]) => Promise<string>
```

## Interfaces

### `MountAnnotateOptions`

```typescript
export interface MountAnnotateOptions {
  /** Base origin for the dev-server API. Defaults to current location. */
  origin?: string
  /** Override the LLui versions reported in frontmatter. Auto-detected
   *  from `window.__llui` when present; otherwise the strings 'unknown'
   *  are used. */
  llui?: { runtime: string; compiler: string }
  /** Suppress the on-page HUD; useful in tests. */
  hidden?: boolean
  /** Inject a custom capture function — used by tests to substitute
   *  the html-to-image pipeline. */
  capture?: CaptureFn
  /** Inject a custom bake function — used by tests to skip the
   *  Image/canvas pipeline. Receives the captured screenshot (base64
   *  with `data:` prefix or raw) + annotations, returns the baked
   *  screenshot as `data:image/png;base64,…` (or any string the
   *  middleware can store as base64). */
  bake?: BakeFn
  /** Disable the SSE subscription to /_llui/events. Tests that don't
   *  want a real EventSource pass `false`; production callers should
   *  leave it `true` (default) so LLM-initiated captures land. */
  subscribeEvents?: boolean
  /** Enable the server-side rehydrate fetch on mount. The HUD calls
   *  /_llui/session/current + /_llui/notes + /_llui/queue right after
   *  mount to restore tracked tasks, chain histories, and pending
   *  Accept toasts after a page reload. Off by default — the vite
   *  plugin sets it to `true` in the injected bootstrap so production
   *  gets reload-survives-solve, while tests that stub `fetch` aren't
   *  surprised by extra calls. */
  rehydrate?: boolean
  /** Whether the attention router is wired up + available. When
   *  `false` (or missing CLI / `router: false` upstream), the HUD
   *  hides its "Solve" button so the user doesn't try to dispatch a
   *  task with no worker behind it. Notes can still be saved.
   *  Default `true`. */
  solveEnabled?: boolean
  /** Install `window.onerror` + `unhandledrejection` listeners. On
   *  an unhandled exception, the HUD opens pre-populated with the
   *  stack + auto-captured screenshot so the user can submit a one-
   *  click solve request. Default `true`. */
  autoCaptureOnError?: boolean
  /** Show the "● Record" toggle in the compose view (repro recorder).
   *  Default `true`. */
  repro?: boolean
  /** Show the "⌖ Pick element" annotation pill alongside Add region.
   *  Default `true`. */
  elementPick?: boolean
}
```

### `AnnotateHudHandle`

```typescript
export interface AnnotateHudHandle {
  open(): void
  close(): void
  destroy(): void
  /** Programmatic submission. Resolves with the created note's metadata
   *  or rejects on HTTP failure. */
  submit(
    prose: string,
    opts?: {
      captureLevel?: CaptureLevel
      annotations?: Annotation[]
      screenshot?: string
      /** Defaults to 'task' for human submissions; pass 'note' for FYI. */
      intent?: NoteIntent
    },
  ): Promise<CreateNoteResponse>
  /** Programmatically trigger the rect-drawing overlay. Resolves when
   *  the user completes or cancels. */
  drawRect(): Promise<NoteRect | null>
  /** Handle a single LLM-initiated capture-request — same code path
   *  as the SSE handler. Exposed for tests and for callers driving the
   *  bridge manually. */
  handleCaptureRequest(
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse>
  /** Set the default intent for floating-button submits. Default 'task'.
   *  Per-call submit() options override this. */
  setIntent(intent: NoteIntent): void
}
```

<!-- auto-api:end -->

## Related

- [`@llui/vite-plugin`](/api/vite-plugin) — the dev-server middleware that backs every HUD HTTP call. See `devmodeAnnotate` config.
- [`@llui/mcp`](/api/mcp) — the LLM-facing side of the same notebook.
- Proposal: [`docs/proposals/devmode-annotate/`](https://github.com/fponticelli/llui/tree/main/docs/proposals/devmode-annotate) — full on-disk format spec, middleware contract, MCP surface, runtime-hook plan, and task-mode design.
