# devmode-annotate — current state

Snapshot of what's actually shipping today. This document is the **contract** used to detect drift in subsequent work — keep it accurate when the surface changes.

The other documents in this directory describe the original proposal (`01` … `05`) and remain useful as design rationale; treat anything they say as superseded by what you read here.

## Wiring

`@llui/devmode-annotate` ships transitively with `@llui/vite-plugin`. Consumers do **not** add it to their own package.json and do **not** call `mountAnnotateHud()` in their app entry. The plugin auto-injects a virtual ES module via `transformIndexHtml` in dev mode:

```html
<script type="module" src="/@id/__x00__virtual:llui-devmode-annotate-init"></script>
```

Production builds never run `transformIndexHtml(serve)`, so the HUD is fully tree-shaken.

The notebook wire-protocol types live in `@llui/devmode-annotate/note-types` (moved here to break a package cycle). `@llui/vite-plugin` re-exports them from its own entry for back-compat; `@llui/mcp` consumes them through that re-export.

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
  autoCaptureOnError?: boolean // default true; install window.onerror/unhandledrejection listeners
  repro?: boolean // default true; show the "● Record" toggle
  elementPick?: boolean // default true; show the "⌖ Pick element" pill
}
```

The plugin computes `solveEnabled` (true iff `router !== false` AND the chosen CLI is on PATH) and threads it into the bootstrap so the HUD knows whether to render the "Solve" split button. The bootstrap also sets `rehydrate: true` so a page reload restores in-flight task tracking — see "Persistence + rehydrate" below.

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
  beforePrompt?: (input: { prompt; note }) => string | Promise<string>
  streaming?: boolean // default true; downgrades stream-json → json when false
}
```

**Preset defaults:**

| Preset   | command  | args                                                                           | promptVia | defaultModel | resumeFlag | outputEnvelope |
| -------- | -------- | ------------------------------------------------------------------------------ | --------- | ------------ | ---------- | -------------- |
| `claude` | `claude` | `--print --dangerously-skip-permissions --verbose --output-format stream-json` | arg       | `sonnet`     | `--resume` | `stream-json`  |
| `codex`  | `codex`  | `exec --full-auto`                                                             | arg       | —            | —          | `text`         |
| `gemini` | `gemini` | `--yolo`                                                                       | stdin     | —            | —          | `text`         |

`router: false` disables both the router AND the HUD's Solve button. `router: { ... }` with `preset: undefined` + `command:` set = fully custom invocation (no preset defaults applied).

CLAUDE.md is loaded automatically by `claude --print` from the configured `projectRoot` — no config needed. `contextFiles` is for _additional_ files (design docs, conventions) the LLM wouldn't otherwise see.

`streaming: true` (default for claude) uses `--output-format stream-json --verbose`; the router parses each line and broadcasts `task-progress` SSE events with running token counts + last tool name + elapsed time. `streaming: false` downgrades to the single `--output-format json` envelope (no in-flight feedback; heartbeat-only).

### Format overrides

```ts
interface NoteFormatConfig {
  formatSessionFolder?: (date: Date) => string // default UTC `session-YYYY-MM-DD-HHMM`
  deriveSlug?: (prose: string) => string // default kebab-case first 4 content words, cap 32 chars
}
```

The id+author+kind prefix of each filename stays fixed (`{id}-{author}-{kind}-{slug}.md`) so filename parsing keeps working. Only the trailing slug and the session folder name are customizable. MCP-side writes (out-of-process) ignore these overrides; only HUD-originated writes through the middleware honour them.

## Solve flow (direct-edit architecture)

Critical: the LLM **edits files directly** during the spawn. The router does NOT ask for a unified diff; it computes one from git after the spawn completes.

1. **Before spawn**, the router calls `captureGitBaseline(projectRoot)` to snapshot `git status --porcelain` (which files were already dirty / untracked).
2. **The prompt** tells the LLM to use `Edit / Write / MultiEdit / Bash` directly to apply the fix. The reply block's `files[]` is a hint list of touched paths; the actual diff comes from git.
3. **After spawn succeeds**, `computeGitDiffSinceBaseline(...)` runs `git diff HEAD -- <file>` for newly-dirty files and synthesizes an add-file patch for newly-untracked files. That becomes the reply note's `proposedDiff` — same shape the HUD's diff viewer renders.
4. **On Accept** — no-op apply. Files are already on disk; status moves to `applied` and the task's transient note files are cleaned up.
5. **On Reject** — `revertProposedChanges(...)` iterates `proposedDiff.files`. Per file: `git checkout HEAD -- <file>` if tracked, `rm` if newly created. Per-file failures don't abort the whole revert; the reason string lists what landed vs. failed.

There is no `git apply` step anymore. The legacy patch-then-apply path was removed along with its CRLF normalizer, line-annotator, and `--3way` fallback — none of which were enough to make LLM-built diffs reliable.

## Resume chains (per-chain session map)

The router maintains `sessionByChain: Map<chainName, sessionId>`. Each task's frontmatter carries `chainName?: string` (default `'default'`); the router resumes the matching chain when `resume: true`.

HUD-side state:

- `chainHistories: Map<chainName, { lastTaskId, summary, ts }>` — populated when a task hits `proposed`; the summary is the LLM's one-line `proposedDiff.summary`, also broadcast as the `reason` on the `status-changed` event.
- `selectedResumeChain: string | null` — `null` = "Start fresh" (next submit mints a new chain id like `chain-N`); a string = "resume this prior chain."

The Solve split-button's caret is **hidden** until `chainHistories.size > 0`. Once a chain exists, the menu lists chains by their LLM-given summary (most recent first), with a "Start fresh" divider at the bottom. After a successful solve, the just-completed chain is auto-selected so the common "I want to continue this" path is one click.

## Middleware (`/_llui/*`)

| Method | Path                             | Behaviour                                                                                                                                |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/_llui/events?role=hud\|viewer` | SSE stream of `ServerEvent`s                                                                                                             |
| POST   | `/_llui/notes`                   | Create a note. Body: `CreateNoteRequest`.                                                                                                |
| GET    | `/_llui/notes?…`                 | List notes. Query: `sessionId`, `author`, `kind`, `since`, `limit`.                                                                      |
| GET    | `/_llui/notes/:id`               | Read a single note. Default: serialized markdown. `?format=json` returns the parsed `SerializedNote`. Query: `sessionId`.                |
| PATCH  | `/_llui/notes/:id`               | Replace prose. Body: `{ prose: string }`. Broadcasts `note-updated`.                                                                     |
| DELETE | `/_llui/notes/:id`               | Delete the `.md` (+ `.png` if present). Broadcasts `note-deleted`.                                                                       |
| GET    | `/_llui/notes/:id/screenshot`    | PNG bytes for the note's screenshot.                                                                                                     |
| GET    | `/_llui/notes/:id/status`        | Read status history.                                                                                                                     |
| POST   | `/_llui/notes/:id/status`        | Body: `{ to: NoteStatus, by?, reason? }`. `to: 'accepted'` triggers the no-op accept; `to: 'rejected'` triggers the working-tree revert. |
| GET    | `/_llui/sessions`                | List sessions. Returns `Array<{ id, noteCount, startedAt }>` — enriched per session.                                                     |
| GET    | `/_llui/session/current`         | Current session info.                                                                                                                    |
| POST   | `/_llui/session/rotate`          | Start a fresh session.                                                                                                                   |
| GET    | `/_llui/queue`                   | Pending task notes. Returns `Array<{ noteId, status, transitions }>`.                                                                    |
| POST   | `/_llui/capture-request`         | LLM-initiated capture (long-poll until HUD responds).                                                                                    |

## Frontmatter shape

`NoteFrontmatter` lives in `@llui/devmode-annotate/note-types`. Fields beyond the obvious id/ts/author/kind/url/route:

- `componentPath: string[] | null` — names of all currently-mounted LLui components (root first).
- `componentMeta: { name, file, line } | null` — for the primary anchor.
- `annotations: Annotation[]` — `rect` and `element` are implemented; `lasso | pin | arrow | highlight` are placeholders.
- `intent?: 'task' | 'note'` — task notes enter the status machine.
- `resume?: boolean` — task notes only. When true AND the active preset has a `resumeFlag` AND the chain has a captured session id, the router appends `[preset.resumeFlag, sessionByChain.get(chainName)]` to the spawn args.
- `chainName?: string` — task notes only. Selects the resume chain; default `'default'`. The HUD's solve flow auto-mints names like `chain-1`, `chain-2`, ... when the user picks "Start fresh".
- `replyTo?: string` + `proposedDiff?: ProposedDiff` — reply notes from the router.
- `fulfillsRequestId?: string` — when this note answers a `capture-request`.

## NoteSummary (list endpoint)

`GET /_llui/notes` returns `NoteSummary[]` with the same core shape plus optional hints surfaced from frontmatter so the HUD can rehydrate state on reload without per-note fetches:

- `intent?` · `chainName?` · `replyTo?` · `proposedSummary?` (for reply notes; lifted from `proposedDiff.summary`).

## Status machine (task-mode notes)

```
open → claimed → in-progress → proposed → accepted → applied (terminal)
                                       ↘ rejected (terminal — revert ran)
                                       ↘ failed (terminal)
                            ↘ wontfix (terminal)
```

- The router writes `claimed` and `proposed` itself.
- The HUD writes `accepted` (Accept button) or `rejected` (Reject button) via `POST /_llui/notes/:id/status`.
- The middleware writes the follow-up `applied` (after Accept; no-op apply) or `rejected → applied/failed` (after Reject, depending on revert outcome).

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
  | { type: 'task-progress'; noteId; elapsedMs; tokens?: { in; out; cacheRead? }; toolSummary? }
```

`task-progress` is debounced server-side to ~250ms (stream-json presets) or sent as a 5s heartbeat (text-envelope presets). The HUD also runs a local 1s elapsed-time ticker so the displayed clock advances between server events.

Roles: `hud` (full feed), `viewer` (subset — no capture-requests).

The router broadcasts `note-created` directly after writing reply notes (bypassing the POST middleware) so the browse view sees them in real time.

## HUD surface

Floating button (44×44, two-line "LLui / HUD" wordmark, draggable + edge-anchored persistence) toggles the modal. Hotkey `⌘⇧A`. Modal contents:

- **Heading row:** view-toggle link (`Browse notes` / `← New note`) + status badges (working / ready counters).
- **Compose view:** context subhead (`/route · <ComponentName> · WxH`) · lineage row (when a chain is selected) · attachment pills (`⌖ Add region`, `⌖ Pick element`) · markdown toolbar (B / I / `</>` / • / 1.) · textarea (with `Describe the issue…` placeholder) · markdown hint · More-options expander (verbose-capture checkbox + record-button) · status line · actions row.
- **Browse view:** session dropdown · filter row (kind / author / status / search) · bulk action bar (when ≥1 selected) · notes list with expandable rows showing screenshot preview · prose · diff viewer (for reply notes) · status timeline · `↻ Re-solve` (task notes) / `Edit` / `Delete` actions.
- **Footer:** keyboard hints (`⌘↩ solve · ⇧⌘↩ save · esc cancel`), only on compose.

The Solve action is a split button. Main click submits with the current resume state. The ▾ caret is **hidden when no chain has completed yet**. Once chains exist, the menu shows each chain's LLM summary (most recent first), then `Start fresh`. The `↻` glyph in the main button shows when a chain is currently selected for resume.

Save submits with intent `note`, Solve with intent `task`.

## Toasts

`spawnToast(kind, body, { actions?, autoDismissMs? })`. Each action carries an optional `variant: 'primary' | 'secondary' | 'ghost'`.

- `kind: 'fail'` toasts **never auto-dismiss** — errors stay visible until the user closes them.
- Toasts with at least one action also don't auto-dismiss (so an Accept/Reject button can't be missed).
- Plain `ok` / `info` toasts auto-dismiss after 8s unless `autoDismissMs` overrides.

Proposed-state toasts (both the live one and the one spawned during rehydrate) show `[ Reject ] [ Accept ]` + close. Reject routes through the revert path; Accept transitions to `applied` (no-op).

## Persistence + rehydrate

**localStorage** (`llui-devmode-annotate.hud-state`): modal open/closed, current view (compose vs browse), draft prose, `selectedResumeChain`. Written debounced 200ms on every relevant change. Restored on mount.

**Server rehydrate** (`rehydrate: true` in the bootstrap): on mount, fetches `/_llui/session/current` + `/_llui/notes?sessionId=current` + `/_llui/queue?sessionId=current`. Reconstructs:

- `trackedTasks` — every in-flight task in the queue.
- `chainHistories` — one entry per chain that has produced a `proposed` reply.
- Accept toasts — re-spawned for any task currently in `proposed` state (so a reload between propose + accept doesn't lose the prompt).

The HUD also runs a defensive **1s elapsed-time ticker** the moment a task enters a working state, so the displayed clock advances even before any `task-progress` events arrive.

## Annotations

- `rect` — draggable region overlay, baked into the screenshot before upload.
- `element` — hover-highlight DOM picker; captures bbox + a stable CSS selector + component path.
- `lasso | pin | arrow | highlight` — type-system placeholders, not implemented.

## Repro recorder

Toggle (`● Start recording` / `■ Stop recording`) in the More-options panel captures `click`, `input`, `keydown`, and `popstate` events between toggle-on and submit. Bounded buffer (200 events), input values truncated to 80 chars, password fields + `[data-llui-private]` subtrees skipped. On submit the captured events attach to `noteBody.repro` as `ReproEvent[]`.

## Dark mode

CSS custom properties scoped to `#llui-devmode-annotate-root` AND `#llui-devmode-annotate-toasts`, flipped via `@media (prefers-color-scheme: dark)`. Injected as a `<style id="llui-devmode-annotate-styles">` tag on mount.

## Screenshot capture

Uses `html-to-image` with:

- `skipFonts: true` (saves ~1s on text-heavy pages),
- `imagePlaceholder` = 1×1 transparent PNG so a single broken/CORS-blocked `<img>` doesn't reject the whole capture,
- `onImageErrorHandler` logs the offending src to the console,
- `cacheBust: true`.

Capture failures are reported with `describeCaptureError(err)` which extracts `target.src` / `target.tagName` from Event-shaped errors instead of showing `[object Event]`.

## Tests

- `packages/devmode-annotate/test/` — HUD UI, drag/persist, screenshot bake, debug-collector, live feedback, browse view.
- `packages/vite-plugin/test/notes-*` — notes store, middleware, router (mockable spawner), session, slug, reply-parser.

## Known limitations / debt

- Annotation tools shipping today: `rect` + `element` (pick). `NoteKind` also includes `lasso | pin | arrow | highlight` (placeholders, not built).
- MCP-side note writes don't honour `format` overrides (out-of-process).
- The router serializes by default; `concurrency > 1` with resume produces non-deterministic chains (a warning is logged when this combination triggers).
- No notes export/import (zip in/out).
- No redact tool that bakes a black rect into the screenshot (PII concern).
- The repro recorder captures events but cannot replay them yet — `@llui/test`'s `replayTrace` would need integration.
- Chains discovered only from the CURRENT session's reply notes. Reply notes from prior sessions aren't surfaced as resumable in the current session even if the router-side `sessionByChain` still has them. (Rehydrate reads only the current session's notes.)
- The example apps may have lingering `.patch.failed` files from the now-removed patch apply path. Safe to delete.
  </content>
  </invoke>
