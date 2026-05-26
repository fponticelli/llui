# devmode-annotate — current state

Snapshot of what's actually shipping today. This document is the **contract** used to detect drift in subsequent work — keep it accurate when the surface changes.

The other documents in this directory describe the original proposal (`01` … `05`) and remain useful as design rationale; treat anything they say as superseded by what you read here.

## Wiring

`@llui/devmode-annotate` ships transitively with `@llui/vite-plugin`. Consumers do **not** add it to their own package.json and do **not** call `mountAnnotateHud()` in their app entry. The plugin auto-injects a virtual ES module via `transformIndexHtml` in dev mode:

```html
<script type="module" src="/@id/__x00__virtual:llui-devmode-annotate-init"></script>
```

Production builds never run `transformIndexHtml(serve)`, so the HUD is fully tree-shaken.

The notebook wire-protocol types now live in `@llui/devmode-annotate/note-types` (moved here to break a package cycle). `@llui/vite-plugin` re-exports them from its own entry for back-compat; `@llui/mcp` consumes them through that re-export.

## Plugin configuration

Top-level: `llui({ devmodeAnnotate: false | DevmodeAnnotateConfig })`. Default = on in dev.

```ts
interface DevmodeAnnotateConfig {
  notesDir?: string // default '.llui/notes' (relative to project root)
  captureTimeoutMs?: number // default 30_000
  format?: NoteFormatConfig // see "Format overrides"
  router?: false | LlmPreset | LlmRouterConfig // see "Router"
  routerTimeoutMs?: number // deprecated alias for router.timeoutMs
  hud?: false | HudInjectionConfig // see "HUD config"
}
```

### HUD config

```ts
interface HudInjectionConfig {
  hidden?: boolean // mount HUD but skip the floating button (programmatic-only)
}
```

The plugin computes `solveEnabled` (true iff `router !== false` AND the chosen CLI is on PATH) and threads it into the bootstrap so the HUD knows whether to render the "Solve" split button.

### Router config

```ts
type LlmPreset = 'claude' | 'codex' | 'gemini'

interface LlmRouterConfig {
  preset?: LlmPreset // default 'claude'
  command?: string // override binary; omit `preset` for a fully custom call
  args?: string[] // override preset args
  model?: string // mapped to preset's modelFlag (`--model`)
  extraArgs?: string[] // appended after model, before prompt
  env?: Record<string, string> // merged with process.env
  promptVia?: 'arg' | 'stdin' // default per preset
  timeoutMs?: number // default 5*60_000
  concurrency?: number // default 1 (serialized)
  contextFiles?: string[] // project-relative paths inlined into every prompt
}
```

**Preset defaults:**

| Preset   | command  | args                                                          | promptVia | defaultModel | resumeFlag | outputEnvelope |
| -------- | -------- | ------------------------------------------------------------- | --------- | ------------ | ---------- | -------------- |
| `claude` | `claude` | `--print --dangerously-skip-permissions --output-format json` | arg       | `sonnet`     | `--resume` | `json`         |
| `codex`  | `codex`  | `exec --full-auto`                                            | arg       | —            | —          | `text`         |
| `gemini` | `gemini` | `--yolo`                                                      | stdin     | —            | —          | `text`         |

`router: false` disables both the router AND the HUD's Solve button. `router: { ... }` with `preset: undefined` + `command:` set = fully custom invocation (no preset defaults applied).

CLAUDE.md is loaded automatically by `claude --print` from the configured `projectRoot` — no config needed. `contextFiles` is for _additional_ files (design docs, conventions) the LLM wouldn't otherwise see.

### Format overrides

```ts
interface NoteFormatConfig {
  formatSessionFolder?: (date: Date) => string // default UTC `session-YYYY-MM-DD-HHMM`
  deriveSlug?: (prose: string) => string // default kebab-case first 4 content words, cap 32 chars
}
```

The id+author+kind prefix of each filename stays fixed (`{id}-{author}-{kind}-{slug}.md`) so filename parsing keeps working. Only the trailing slug and the session folder name are customizable. MCP-side writes (out-of-process) ignore these overrides; only HUD-originated writes through the middleware honour them.

## Middleware (`/_llui/*`)

| Method   | Path                             | Behaviour                                                            |
| -------- | -------------------------------- | -------------------------------------------------------------------- |
| GET      | `/_llui/events?role=hud\|viewer` | SSE stream of `ServerEvent`s                                         |
| POST     | `/_llui/notes`                   | Create a note. Body: `CreateNoteRequest`.                            |
| GET      | `/_llui/notes?…`                 | List notes. Query: `sessionId`, `author`, `kind`, `since`, `limit`.  |
| GET      | `/_llui/notes/:id`               | Read a single note as markdown. Query: `sessionId`.                  |
| PATCH    | `/_llui/notes/:id`               | Replace prose. Body: `{ prose: string }`. Broadcasts `note-updated`. |
| DELETE   | `/_llui/notes/:id`               | Delete the `.md` (+ `.png` if present). Broadcasts `note-deleted`.   |
| GET      | `/_llui/notes/:id/screenshot`    | PNG bytes for the note's screenshot.                                 |
| GET/POST | `/_llui/notes/:id/status`        | Read status history; POST a transition.                              |
| GET      | `/_llui/sessions`                | List all sessions.                                                   |
| GET      | `/_llui/session/current`         | Current session info.                                                |
| POST     | `/_llui/session/rotate`          | Start a fresh session.                                               |
| GET      | `/_llui/queue`                   | Pending task notes.                                                  |
| POST     | `/_llui/capture-request`         | LLM-initiated capture (long-poll until HUD responds).                |

## Frontmatter shape

`NoteFrontmatter` lives in `@llui/devmode-annotate/note-types`. Fields beyond the obvious id/ts/author/kind/url/route:

- `componentPath: string[] | null` — names of all currently-mounted LLui components (root first).
- `componentMeta: { name, file, line } | null` — for the primary anchor.
- `annotations: Annotation[]` — discriminated union; today only `'rect'` is implemented.
- `intent?: 'task' | 'note'` — task notes enter the status machine.
- `resume?: boolean` — task notes only. When true, router appends `[preset.resumeFlag, lastSessionId]` to the spawn args.
- `replyTo?: string` + `proposedDiff?: ProposedDiff` — reply notes from the router.
- `fulfillsRequestId?: string` — when this note answers a `capture-request`.

## Status machine (task-mode notes)

`open` → `claimed` → `in-progress` → `proposed` → `accepted` → `applied` (terminal)
↘ `rejected` (terminal)
↘ `failed` (terminal)
↘ `wontfix` (terminal)

The router writes `claimed` and `proposed` itself; the user (via HUD Accept button) writes `accepted`; the middleware writes `applied` after `git apply`.

## Server events

```ts
type ServerEvent =
  | { type: 'note-created'; id; filename; author }
  | { type: 'note-updated'; id; sessionId }
  | { type: 'note-deleted'; id; sessionId }
  | { type: 'capture-request'; requestId; payload }
  | { type: 'capture-request-cancelled'; requestId }
  | { type: 'session-rotated'; sessionId }
  | { type: 'status-changed'; noteId; from; to; reason? }
```

Roles: `hud` (full feed), `viewer` (subset — no capture-requests).

## HUD surface

Floating button (44×44, two-line "LLui / HUD" wordmark, draggable + edge-anchored persistence) toggles the modal. Hotkey `⌘⇧A`. Modal contents:

- Heading row: view-toggle link ("Browse notes" / "← New note") + status badges (working / ready counters).
- **Compose view:** context subhead · `⌖ Add region` pill · markdown toolbar (B/I/`</>`/•/1.) · textarea · markdown hint · More-options expander (verbose-capture checkbox) · status line · actions row.
- **Browse view:** session dropdown · notes list with expandable rows showing prose + status timeline + Edit/Delete.
- Footer: keyboard hints (`⌘↩ solve · ⇧⌘↩ save · esc cancel`), only on compose.

The Solve action is a split button: main click submits with the current resume mode, the ▾ caret opens a small menu (`● Resume previous / ○ Start fresh`). The ↻ glyph inside the main button reflects current state. Save submits with intent `note`, Solve with intent `task`.

Resume mechanics: the router tracks `lastSessionId` per dev-server lifetime. On the next task whose frontmatter has `resume: true`, it passes `--resume <lastSessionId>` to claude. The first task in a lifetime never resumes. With `concurrency > 1`, the router logs a warning since multiple resumes against the same baseline can chain unpredictably.

## Dark mode

CSS custom properties scoped to `#llui-devmode-annotate-root`, flipped via `@media (prefers-color-scheme: dark)`. Injected as a `<style id="llui-devmode-annotate-styles">` tag on mount.

## Screenshot capture

Uses `html-to-image` with:

- `skipFonts: true` (saves ~1s on text-heavy pages),
- `imagePlaceholder` = 1×1 transparent PNG so a single broken `<img>` doesn't reject the whole capture,
- `onImageErrorHandler` logs the offending src to the console,
- `cacheBust: true`.

Capture failures are reported with `describeCaptureError(err)` which extracts `target.src` / `target.tagName` from Event-shaped errors instead of showing `[object Event]`.

## Tests

- `packages/devmode-annotate/test/` — HUD UI, drag/persist, screenshot bake, debug-collector, live feedback, browse view (planned).
- `packages/vite-plugin/test/notes-*` — notes store, middleware, router (mockable spawner), session, slug.

## Known limitations / debt

- Only `rect` annotations implemented; the `NoteKind` union also includes `lasso | pin | element | arrow` (placeholders).
- MCP-side note writes don't honour `format` overrides (out-of-process).
- The router serializes by default; `concurrency > 1` with resume produces non-deterministic chains.
- No streaming feedback during solve — claude `--print` only emits its final JSON envelope. Tracked: see proposal for switching to `--output-format stream-json`.
- No notes export/import.
- No element-pick / pin / arrow / redact annotation tools (proposed, not built).
- No auto-capture on uncaught error; no repro recorder.
  </content>
  </invoke>
