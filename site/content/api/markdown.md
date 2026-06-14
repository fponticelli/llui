---
title: '@llui/markdown'
description: 'Reactive Markdown rendering for LLui — parse to mdast and build real reactive DOM (never an HTML string), with per-node renderer overrides and streaming-friendly keyed blocks.'
---

# @llui/markdown

Turns a Markdown string into real LLui DOM. `markdown(source)` parses to an [mdast](https://github.com/syntax-tree/mdast) AST and renders it through LLui's authoring helpers as live reactive nodes — there is no virtual DOM and no `dangerouslySetInnerHTML`. Bind it to a reactive `source` signal and the preview re-renders as the string changes; top-level blocks are content-hash-keyed, so a growing or streaming document reuses the DOM of unchanged blocks instead of rebuilding.

This is the render-only counterpart to [`@llui/markdown-editor`](/api/markdown-editor). Reach for `@llui/markdown` when you want to _display_ Markdown (docs, previews, chat transcripts, streamed model output); reach for the editor when you want a WYSIWYG editing surface.

```bash
pnpm add @llui/markdown @llui/dom
```

`@llui/dom` is a peer dependency.

## What it gives you

- **Markdown in, LLui DOM out.** `markdown(source, options?)` builds real reactive nodes; `renderMarkdown` and `parseMarkdown` expose the lower-level render/parse steps.
- **Pluggable rendering.** A `Renderers` map lets you override any mdast node type (headings, blockquotes, code, …) while inheriting `defaultRenderers` for everything else; `mergeRenderers` composes a partial override set over the built-ins.
- **Safe by default.** `sanitizeUrl` / `resolveUrl` guard `href`/`src` values; raw HTML handling is opt-in.
- **Streaming-friendly.** `toKeyedBlocks` / `blockSource` key top-level blocks by content hash so incremental updates reconcile rather than rebuild.

## API

<!-- auto-api:start -->

## Functions

### `renderMarkdown()`

Render an already-parsed mdast {@link Root} to LLui DOM (no wrapper element).
Returns the rendered top-level blocks.

```typescript
function renderMarkdown(root: Root, opts: MarkdownOptions = {}): Renderable
```

### `markdown()`

Reactive Markdown view. Composes like `text()`/`unsafeHtml()` — returns a
`Mountable` placed in a view.

- Plain `string` source → parsed once, rendered statically.
- `Signal<string>` source → re-parsed on change; top-level blocks are keyed by a
  content hash and rendered through `each`, so unchanged earlier blocks keep their
  DOM and only the changing tail (and appended blocks) rebuild. This makes
  streaming / growing Markdown (e.g. LLM output) cheap to render.

```typescript
function markdown(source: Reactive<string>, opts: MarkdownOptions = {}): Mountable
```

### `parseMarkdown()`

Parse Markdown source into an mdast {@link Root}. GFM is on unless
`opts.gfm === false`. Extra `extensions`/`mdastExtensions` are appended.

```typescript
function parseMarkdown(src: string, opts: MarkdownOptions = {}): Root
```

### `mergeRenderers()`

Merge user overrides over the built-in defaults into a uniform registry.

```typescript
function mergeRenderers(user?: Renderers): ResolvedRenderers
```

### `sanitizeUrl()`

Returns the URL unchanged if its scheme is allowed (or it is relative),
otherwise `null`.

```typescript
function sanitizeUrl(url: string, allowedProtocols: readonly string[]): string | null
```

### `resolveUrl()`

Resolve a link/image URL through `transformLink` (if any) then sanitize it.
Returns the final URL, or `null` if the link/image should be dropped.

```typescript
function resolveUrl(
  url: string,
  node: Link | Image | LinkReference | ImageReference,
  options: ResolvedOptions,
): string | null
```

### `collectDefinitions()`

Walk the tree and collect every link/image reference definition, keyed by
lowercased identifier (so `linkReference`/`imageReference` nodes can resolve).

```typescript
function collectDefinitions(root: Root): Map<string, Definition>
```

### `makeContext()`

Build the context renderers receive: `render` dispatches one node through the
merged registry, `renderChildren` recurses, `definitions` resolves references.

```typescript
function makeContext(
  options: ResolvedOptions,
  definitions: ReadonlyMap<string, Definition>,
): RenderContext
```

### `blockSource()`

The block's source text (via mdast position offsets), or a structural fallback.

```typescript
function blockSource(node: RootContent, source: string): string
```

### `toKeyedBlocks()`

Derive a stable, unique-per-render key for each top-level block. Identical block
source ⇒ identical base key; duplicates get a `#n` suffix to stay unique.

```typescript
function toKeyedBlocks(root: Root, source: string, options: ResolvedOptions): KeyedBlock[]
```

### `resolveOptions()`

```typescript
function resolveOptions(opts: MarkdownOptions = {}): ResolvedOptions
```

## Types

### `BuiltinRenderers`

The built-in registry: every built-in node type, uniformly callable. Its keys
are statically known, so `defaultRenderers.heading(node, ctx)` (delegating from a
custom override) type-checks without an undefined guard.

```typescript
export type BuiltinRenderers = { [K in keyof typeof builtins]: NodeRenderer<Node> }
```

### `NodeRenderer`

A node renderer turns one mdast node into Renderable LLui DOM. It receives the
node and a {@link RenderContext} for recursing into children / sibling nodes.

```typescript
export type NodeRenderer<N extends Node = Node> = (node: N, ctx: RenderContext) => Renderable
```

### `Renderers`

Per-node-type render overrides, merged OVER the built-in {@link defaultRenderers}.
Known mdast types are precisely typed; the string index admits custom node types.
The index value is typed `NodeRenderer<never>` on purpose: a `(node: Heading) => …`
renderer is assignable to `(node: never) => …` (parameters are contravariant, and
`never` is a subtype of every type), so the precise per-type renderers and custom
renderers coexist without the variance conflict a `NodeRenderer<Node>` index would
cause. Author custom renderers with an explicit param type (`(node: MyNode) => …`).

```typescript
export type Renderers = {
  [K in Nodes['type']]?: NodeRenderer<Extract<Nodes, { type: K }>>
} & {
  [type: string]: NodeRenderer<never> | undefined
}
```

### `ResolvedRenderers`

Internal: the merged registry after defaults are applied. Every renderer is
uniformly callable with a base `Node` (dispatch only ever calls the renderer
whose key matches `node.type`, so the widening is sound).

```typescript
export type ResolvedRenderers = Record<string, NodeRenderer<Node>>
```

### `TransformLink`

A URL the renderer is about to emit (link href / image src), with the source
node. Return a rewritten URL, or `null` to drop the link/image entirely.

```typescript
export type TransformLink = (
  href: string,
  node: Link | Image | LinkReference | ImageReference,
) => string | null
```

## Interfaces

### `KeyedBlock`

```typescript
export interface KeyedBlock {
  /** Reconcile identity for the outer keyed list (from `keyOf`, else content-based). */
  key: string | number
  /** Content identity — changes iff the block's source changes. Drives in-place
   * row rebuilds when a custom `keyOf` gives blocks stable identity. */
  hash: string
  node: Nodes
}
```

### `MarkdownOptions`

```typescript
export interface MarkdownOptions {
  /** Enable GitHub Flavored Markdown (tables, strikethrough, task lists,
   * autolinks, footnotes). Default `true`. */
  gfm?: boolean
  /** Per-node-type render overrides, merged over the built-in defaults. */
  renderers?: Renderers
  /** Extra micromark syntax extensions (custom block/inline syntax). */
  extensions?: FromMarkdownOptions['extensions']
  /** Extra mdast extensions matching the syntax extensions above. */
  mdastExtensions?: FromMarkdownOptions['mdastExtensions']
  /** Sanitizer for raw HTML nodes. Raw HTML is **dropped by default**
   * (safe for untrusted/LLM content). To render it, supply a function
   * that takes the raw HTML and returns a sanitized string (e.g. wrap
   * DOMPurify); the result is injected verbatim. There is intentionally
   * no "render raw HTML unsanitized" switch — that would be an XSS sink. */
  sanitizeHtml?: (html: string) => string
  /** URL schemes permitted in links/images. A URL with no scheme (relative,
   * anchor, query) is always allowed. Default `['http','https','mailto','tel']`. */
  allowedProtocols?: string[]
  /** Rewrite or drop link/image URLs before sanitization. */
  transformLink?: TransformLink
  /** Class applied to the root wrapper element. Default `'markdown-body'`. */
  class?: string
  /** Override the key derived for each top-level block (controls reuse during
   * reactive/streaming updates). Default: a content hash of the block's source. */
  keyOf?: (node: Nodes, index: number) => string | number
}
```

### `ResolvedOptions`

Fully-resolved options with defaults applied — what renderers see on `ctx`.

```typescript
export interface ResolvedOptions {
  gfm: boolean
  renderers: ResolvedRenderers
  extensions: FromMarkdownOptions['extensions']
  mdastExtensions: FromMarkdownOptions['mdastExtensions']
  sanitizeHtml: ((html: string) => string) | undefined
  allowedProtocols: string[]
  transformLink: TransformLink | undefined
  class: string
  keyOf: ((node: Nodes, index: number) => string | number) | undefined
}
```

### `RenderContext`

Passed to every {@link NodeRenderer}: recurse, resolve references, read options.

```typescript
export interface RenderContext {
  /** Render a single node via the registry (unknown types render nothing). */
  render: (node: Node) => Renderable
  /** Render all children of a parent node, flattened. */
  renderChildren: (parent: { children: readonly Node[] }) => Renderable
  /** Link/image reference definitions collected from the whole document, keyed
   * by lowercased identifier. */
  definitions: ReadonlyMap<string, Definition>
  /** The resolved options. */
  options: ResolvedOptions
}
```

## Constants

### `defaultRenderers`

```typescript
const defaultRenderers: BuiltinRenderers
```

<!-- auto-api:end -->
