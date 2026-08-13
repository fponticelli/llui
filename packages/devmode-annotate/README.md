# @llui/devmode-annotate

A HUD that lets you drop annotated notes from a running LLui app into a shared on-disk notebook — picked up automatically by the LLM via `@llui/mcp`.

## What it does

Mounts a floating 📝 button (bottom-right, draggable). Clicking it (or `Cmd/Ctrl+Shift+A`) opens a composer: a Markdown editor plus the capture tools — draw a rectangle, pick an element under the cursor, attach a screenshot, record an interaction trace to replay. Submitting `POST`s the note to the `@llui/vite-plugin` middleware at `/_llui/notes`, which writes a markdown file under `.llui/notes/session-…/` with full metadata (URL, viewport, route, component path under the cursor, scope state, recent messages, LLui versions).

The HUD also browses the notebook, files notes as tasks, shows the LLM's replies and proposed fixes, and answers LLM-initiated capture requests over the dev server's SSE channel. Both sides read and write the same directory.

## Install

The HUD is an optional, consumer-provided package — `@llui/vite-plugin` deliberately does **not** depend on it (that would drag the editor stack into every app that installs the plugin). Add it yourself:

```bash
pnpm add -D @llui/devmode-annotate
```

That is all the dev-server setup there is: the plugin resolves the package from your project root and injects a `<script type="module">` that mounts the HUD, via `transformIndexHtml` in dev. A build never runs that hook, so a production bundle contains no reference to this package at all — no app-entry import, nothing to tree-shake. (Injection silently no-ops when the package isn't installed.) See [Opting out / customizing](#opting-out--customizing).

For a live app that ships the HUD deliberately, install it as a regular dependency and wire it yourself — [next section](#shipping-it-in-a-live-app).

## Shipping it in a live app

The HUD is not free: it embeds a Markdown editor, so its module graph pulls in Lexical, `html-to-image` and `fflate`. Two entry points, and the difference is what your users download.

**Use `@llui/devmode-annotate/install`.** It registers the activation trigger and `import()`s the HUD only when the trigger fires, so the bundler splits the whole HUD into a chunk nobody fetches until it is opened:

```ts
// src/main.ts
import { installAnnotateHud } from '@llui/devmode-annotate/install'

// Behind the host's own authorization — this is a live app.
if (currentUser.isStaff) installAnnotateHud()
```

`installAnnotateHud(opts)` takes every `mountAnnotateHud` option plus `trigger` (default `true`, the `Cmd/Ctrl+Shift+A` bootstrap listener), and defaults `allowProduction: true` + `isolate: true` (shadow-DOM style isolation). It returns `{ activate, dispose }`: `activate()` resolves to the live `AnnotateHudHandle` and is idempotent, `dispose()` drops the bootstrap listener.

**Do not import `mountAnnotateHud` from the barrel in a production entry.** The mount gate (`import.meta.env.DEV`, unless `allowProduction`) is a _runtime_ check inside a module that statically imports the editor, so no bundler can drop it — the HUD ships whether or not it ever mounts. Measured on this package with a stock production Vite build:

| App entry imports                                | Entry chunk                          | Deferred                         |
| ------------------------------------------------ | ------------------------------------ | -------------------------------- |
| `installAnnotateHud` from `…/install`            | **1.8 kB** (999 B gzip)              | 506 kB JS + 13 kB CSS, on demand |
| `mountAnnotateHud` from `@llui/devmode-annotate` | **506 kB** (161 kB gzip) + 13 kB CSS | —                                |

(`test/entry-boundaries.test.ts` pins the properties those numbers rest on: `src/install.ts` reaches the HUD only through an erased `import type` and a dynamic `import()`, and the store entry below never reaches the HUD at all.)

## Use under the dev server

The plugin already mounts it. To mount it yourself in a dev-only entry, keep the import dynamic so the build can drop it:

```ts
// src/main.ts
if (import.meta.env.DEV) {
  void import('@llui/devmode-annotate').then((m) => m.mountAnnotateHud())
}
```

A static `import { mountAnnotateHud } from '@llui/devmode-annotate'` at the top of your entry ships the HUD in every build, dev gate or not.

## Without a dev server

The HUD talks to a `NotesStore`, not to `/_llui/*` directly. Pass `store` to run it anywhere:

- `indexedDbStore()` — the notebook lives in the browser; notes and screenshots persist locally and the HUD's Export button produces a `.zip` in the canonical on-disk layout.
- `httpStore({ baseUrl, headers })` — a host backend speaking the same wire protocol.
- Your own adapter implementing `NotesStore` (including `dispose()`, which the HUD calls from `destroy()` to release object URLs and connections).

Import them from `@llui/devmode-annotate/stores`, **not** from the package barrel — the barrel is the HUD, so naming a store there would pull the editor into your entry chunk and undo the lazy install:

```ts
import { installAnnotateHud } from '@llui/devmode-annotate/install'
import { indexedDbStore } from '@llui/devmode-annotate/stores'

installAnnotateHud({ store: indexedDbStore() })
```

The store entry is eager (you construct the store up front): measured at 59 kB / 20 kB gzip, almost all of it the frontmatter serializer. The HUD itself still waits for activation.

## Opting out / customizing

The plugin owns both the notebook endpoint and the injected HUD:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [
    llui({
      devmodeAnnotate: false, // opt out entirely
      // or: devmodeAnnotate: {
      //   notesDir: 'tmp/notes',
      //   captureTimeoutMs: 60_000,
      //   hud: false,                  // keep the endpoint, skip the HUD injection
      // }
    }),
  ],
})
```

## API

Full signatures: [llui.dev/api/devmode-annotate](https://llui.dev/api/devmode-annotate).

- `mountAnnotateHud(opts?) → AnnotateHudHandle` — mount now. Idempotent: a second call (including one re-entered from inside the first) returns the handle of the one live HUD. `destroy()` tears down every listener, timer, subscription and node it created.
- `installAnnotateHud(opts?) → { activate, dispose }` — the lazy production entry, at `@llui/devmode-annotate/install`.
- `devServerStore` / `httpStore` / `indexedDbStore` + the `NotesStore` types — at `@llui/devmode-annotate/stores` (also re-exported from the barrel, for code that has already paid for it).
- Handle: `open` / `close` / `destroy` / `setProse` / `submit` / `drawRect` / `handleCaptureRequest` / `setIntent` / `replayRepro` / `exportBundle`.
- Notable options: `store`, `allowProduction`, `isolate`, `hidden`, `redact` (per-channel state/repro/screenshot redaction hooks), `captureDebug`, `repro`, `elementPick`, `autoCaptureOnError`, `solveEnabled`.

## Keyboard

- `Cmd/Ctrl+Shift+A` — open the HUD modal
- `Escape` — close it

## What ends up on disk

After submitting "edit button copy is wrong":

```
.llui/notes/
  session-2026-05-23-1432/
    001-human-text-edit-button-copy-wrong.md
    001-human-text-edit-button-copy-wrong.png   # when the note carries a screenshot
    status.jsonl                                # task status transitions
```

The `.md` file carries the prose plus a frontmatter block with URL, viewport, route, component path, LLui versions — everything the LLM needs to act on the note without round-trips. The format is `@llui/notes-format`; the design notes live in the [devmode-annotate proposal](../../docs/proposals/devmode-annotate/) (`current-state.md` is the one kept current).
