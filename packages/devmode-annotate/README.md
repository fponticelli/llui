# @llui/devmode-annotate

A dev-mode HUD that lets you drop annotated notes from a running LLui app into a shared on-disk notebook — picked up automatically by the LLM via `@llui/mcp`.

This is **v1**: text-only notes, no annotations yet. Rect / lasso / pin / element-pick / screenshot baking land in P2 of the [devmode-annotate proposal](../../docs/proposals/devmode-annotate/).

## What it does

In dev mode, mounts a floating 📝 button (bottom-right corner) on your app. Clicking the button (or `Cmd/Ctrl+Shift+A`) opens a textarea. Submitting `POST`s a note to the `@llui/vite-plugin` middleware at `/_llui/notes`, which writes a markdown file under `.llui/notes/session-…/` with full metadata (URL, viewport, route, LLui versions, etc).

Both the developer and an MCP-connected LLM read the same notebook. The MCP server can subscribe to new notes and respond, propose fixes, or capture more context.

## Install

Inside a project that already uses `@llui/vite-plugin`:

```bash
pnpm add -D @llui/devmode-annotate
```

## Use

**1. Enable the notebook endpoint in your Vite plugin config.** This mounts `/_llui/*` on the dev server — opt-in:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [
    llui({
      devmodeAnnotate: true,
      // or: devmodeAnnotate: { notesDir: 'tmp/notes', captureTimeoutMs: 60_000 }
    }),
  ],
})
```

**2. Mount the HUD in your app entry:**

```ts
// src/main.ts
import { mountAnnotateHud } from '@llui/devmode-annotate'

mountAnnotateHud()
```

That's it. The HUD is gated by `import.meta.env.DEV`; in production builds the call tree-shakes out to a no-op. If the Vite plugin option is omitted (or `false`), the HUD will see 404s when posting — turn it on in `vite.config.ts` to enable the round-trip.

## API

### `mountAnnotateHud(options?)` → `AnnotateHudHandle`

Mount the HUD. Idempotent — calling twice returns the same handle.

```ts
interface MountAnnotateOptions {
  /** Base origin for the dev-server API. Defaults to current location. */
  origin?: string
  /** Override the LLui versions in frontmatter. Auto-detected from
   *  `window.__llui` (set by @llui/dom's dev surface). */
  llui?: { runtime: string; compiler: string }
  /** Hide the on-page button (programmatic-only mode). */
  hidden?: boolean
}

interface AnnotateHudHandle {
  open(): void
  close(): void
  destroy(): void
  /** Submit a note programmatically; resolves with the created note metadata. */
  submit(
    prose: string,
    opts?: { captureLevel?: 'standard' | 'verbose' },
  ): Promise<CreateNoteResponse>
}
```

## Keyboard

- `Cmd/Ctrl+Shift+A` — open the HUD modal
- `Escape` — close it

## What ends up on disk

After submitting "edit button copy is wrong":

```
.llui/notes/
  session-2026-05-23-1432/
    001-human-text-edit-button-copy-wrong.md
```

The `.md` file carries the prose plus a frontmatter block with URL, viewport, route, LLui versions — everything the LLM needs to act on the note without round-trips.

## Status

v1 — text-only. Annotations, screenshots, element-pick, LLM-initiated capture all land in later phases. See the [proposal](../../docs/proposals/devmode-annotate/) for the full plan.
