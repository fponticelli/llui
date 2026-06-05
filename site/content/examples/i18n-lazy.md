---
title: 'i18n + Lazy'
description: 'Four-locale switching (with RTL) and a lazily code-split module.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/i18n-lazy/</span>
    <a class="example-embed-open" href="/apps/i18n-lazy/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/i18n-lazy/" title="i18n + Lazy — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/i18n-lazy" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

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
