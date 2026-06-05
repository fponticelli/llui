# Dashboard

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
