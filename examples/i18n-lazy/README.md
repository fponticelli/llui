# i18n + Lazy Loading

Locale switching across four languages (including right-to-left Arabic) with a lazily code-split stats module.

## What it demonstrates

- `lazy(...)` code-splitting with fallback and error states — the stats section's bundle loads on demand.
- `@llui/components` `LocaleContext` so components read locale-aware labels from context.
- Effects-as-data syncing the document's `lang`/`dir` for proper RTL layout.
- Custom per-locale overrides for `en`, `es`, `ja`, and `ar`.

## UI

Four locale buttons, a dialog whose close label comes from context, and a stats section that lazy-loads on first click. Selecting Arabic flips the layout to RTL.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-i18n-lazy dev
```
