---
title: 'Dashboard'
description: 'KPI cards, animated charts, a reorderable list, locale + theme switching.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/dashboard/</span>
    <a class="example-embed-open" href="/apps/dashboard/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/dashboard/" title="Dashboard — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/dashboard" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

An analytics dashboard with KPI cards, animated charts, a reorderable priority list, and live locale + theme switching.

## What it demonstrates

- Locale-aware formatting: `formatNumber`, `formatDate`, `formatRelativeTime`, and `formatList`.
- `@llui/components` building blocks — sortable, drag-to-reorder lists and an `inView` intersection-observer wrapper for lazy chart rendering.
- `each(...)` keyed lists and state derived across several signals at once.
- Signal-driven chart animations that play when a chart scrolls into view.
- Theme and locale toggles that re-render formatting throughout the page.

## UI

A header with theme/locale toggles, KPI metric cards, animated bar and line charts (rendered on scroll), a draggable priority list, and an activity feed with relative timestamps.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-dashboard dev
```
