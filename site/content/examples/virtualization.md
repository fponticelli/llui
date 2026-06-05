---
title: 'Virtualization'
description: 'A 50,000-row log viewer that keeps only visible rows in the DOM.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/virtualization/</span>
    <a class="example-embed-open" href="/apps/virtualization/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/virtualization/" title="Virtualization — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/virtualization" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

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
