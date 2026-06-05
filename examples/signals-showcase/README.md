# Signals Showcase

Three small components — a counter, a todo list, and a contentEditable editor — that together exercise the **entire** signal authoring surface. This is the canonical reference for authoring LLui with signals.

## What it demonstrates

- `state.at(...)` leaf reads and `.map(...)` text transforms.
- `show(...)` conditional mounting and `branch(...)` discriminated-union view switching.
- `each(...)` keyed lists with per-row item signals.
- `derived(...)` computed values across independent signals.
- `foreign(...)` imperative boundaries — the word-counting contentEditable editor.
- Effects-as-data: the counter's beep on first positive value and the todos' async load.

See [`FEATURES.md`](https://github.com/fponticelli/llui/blob/main/examples/signals-showcase/FEATURES.md) for the full feature-to-code mapping table.

## UI

Three independent mini-apps side by side: a counter with a beep effect, a filterable todo list, and a contentEditable text editor that counts words live.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-signals-showcase dev
```
