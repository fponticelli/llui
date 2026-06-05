# Virtualization

A log viewer that scrolls through **50,000 rows** while keeping only the visible handful in the DOM.

## What it demonstrates

- `virtualEach(...)` — windowed list rendering with a fixed item height.
- `onMount(...)` lifecycle used to wire up a mutation observer that counts live rows.
- A range slider that resizes the dataset on the fly.
- Signal-driven table rows with level-based styling.

## UI

A scrollable virtual log table over 50,000 entries that only ever renders ~15 rows at once, a slider to change the total row count, and a stats readout comparing DOM-rendered rows to the total.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-virtualization dev
```
