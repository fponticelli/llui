# LLui Markdown Showcase — demo

A live showcase of [`@llui/markdown`](../../packages/markdown): a reactive `markdown()` renderer
that turns a Markdown string into real LLui DOM, with per-node renderer overrides.

```bash
pnpm --filter @llui/example-markdown-showcase dev
```

## What it shows

1. **Live preview** — an editor bound to a single `source` string drives a reactive `markdown()`
   preview. The source is the only source of truth; the preview re-renders as you type.

2. **Streaming** — tokenizes the sample into words and streams them into the source one tick at a
   time, demonstrating that the renderer reconciles incremental updates rather than rebuilding.

3. **Custom renderers** — a toggle swaps in `fancyRenderers`, which override individual node types:
   headings get slug ids + a hover anchor link, blockquotes become styled callouts, and fenced
   code gets a language-badge header bar. Every node type not overridden keeps its built-in
   rendering.

4. **Theme toggle** — switches between the bundled light and dark Markdown themes
   (`@llui/markdown/styles/theme.css` / `theme-dark.css`).

## Highlights

- **Markdown in, LLui DOM out.** No virtual DOM, no `dangerouslySetInnerHTML` — `markdown()`
  builds real reactive nodes.
- **Pluggable rendering.** `Renderers` lets you override any mdast node type while inheriting the
  defaults for the rest.
- **Idiomatic LLui.** A single component with reactive bindings and effects-as-data (the streaming
  tick is an effect handled in `onEffect`).
