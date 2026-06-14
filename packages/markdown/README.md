# @llui/markdown

Reactive Markdown rendering for [LLui](https://github.com/fponticelli/llui).

Parses Markdown to a real [mdast](https://github.com/syntax-tree/mdast) AST
([micromark](https://github.com/micromark/micromark) + GFM) and renders it
through LLui's own authoring helpers as **live reactive DOM** — never an HTML
string. That means:

- **Reactive** — drive it with a `Signal<string>`; the view updates when the source changes.
- **Streaming-friendly** — top-level blocks are content-hash-keyed, so a growing
  document (e.g. LLM output) reuses the DOM of unchanged earlier blocks and only
  rebuilds the changing tail.
- **Complete** — full CommonMark + GFM (tables, strikethrough, task lists, autolinks, footnotes).
- **Extensible** — override any node's rendering, or register custom node types via micromark/mdast extensions.
- **Safe by default** — raw HTML is dropped and dangerous URL schemes (`javascript:`, `data:`, …) are neutralized unless you opt in.

## Install

```bash
pnpm add @llui/markdown
```

`@llui/dom` is a peer dependency.

## Usage

`markdown()` is a view helper — it returns a `Mountable`, so it composes like
`text()` or any element helper:

```ts
import { component, div } from '@llui/dom'
import { markdown } from '@llui/markdown'
import '@llui/markdown/styles/theme.css' // optional default styling

interface State {
  source: string
}
type Msg = { type: 'edit'; value: string }

export const Doc = component<State, Msg>({
  init: () => ({ source: '# Hello\n\nThis is **live**.' }),
  update: (s, m) => (m.type === 'edit' ? { source: m.value } : s),
  // state.at('source') is a Signal<string> — the render reacts to it.
  view: ({ state }) => [div([markdown(state.at('source'))])],
})
```

A plain string works too (rendered once, no reactivity):

```ts
div([markdown('# Static\n\nRendered once.')])
```

## Streaming / LLM output

Because top-level blocks are keyed by a hash of their source, feeding a growing
string only rebuilds the part that changed:

```ts
// As tokens stream in, send the accumulated text:
update: (s, m) => (m.type === 'chunk' ? { source: s.source + m.text } : s)
```

Earlier blocks keep their exact DOM nodes; only the last (still-growing) block
and any newly-completed blocks are built. No diffing of a virtual tree, no
re-rendering settled content.

## Custom rendering

Override any node type. Renderers receive the mdast node and a context for
recursing into children:

```ts
import { markdown, defaultRenderers, type NodeRenderer } from '@llui/markdown'
import { a, h2 } from '@llui/dom'
import type { Heading } from 'mdast'

// Add anchor links to h2 headings; delegate other depths to the built-in.
const heading: NodeRenderer<Heading> = (node, ctx) => {
  if (node.depth !== 2) return defaultRenderers.heading(node, ctx)
  const text = node.children.map((c) => ('value' in c ? c.value : '')).join('')
  const id = text.toLowerCase().replace(/\s+/g, '-')
  return [h2({ id }, [a({ href: `#${id}` }, ctx.renderChildren(node))])]
}

markdown(source, { renderers: { heading } })
```

Overrides are merged over the built-in `defaultRenderers`; any type you don't
override keeps its default. Export `defaultRenderers` if you want to delegate to
the built-in for some cases.

### Custom node types

Register a micromark syntax extension + matching mdast extension, then a renderer
keyed by the new node `type`:

```ts
import { myExtension } from 'micromark-extension-mine'
import { myFromMarkdown } from 'mdast-util-mine'

markdown(source, {
  extensions: [myExtension()],
  mdastExtensions: [myFromMarkdown()],
  renderers: {
    myNode: (node, ctx) => [
      /* …build DOM… */
    ],
  },
})
```

## Syntax highlighting

The core ships no highlighter (keeping it dependency-light). Plug one in with a
custom `code` renderer and `foreign()` — the imperative-library boundary:

```ts
import { markdown, type NodeRenderer } from '@llui/markdown'
import { foreign } from '@llui/dom'
import { codeToHtml } from 'shiki'
import type { Code } from 'mdast'

const code: NodeRenderer<Code> = (node) => [
  foreign({
    tag: 'div',
    mount: ({ el }) => {
      el.className = 'shiki-host'
      codeToHtml(node.value, { lang: node.lang ?? 'text', theme: 'github-dark' }).then((html) => {
        el.innerHTML = html
      })
      return null
    },
  }),
]

markdown(source, { renderers: { code } })
```

The same shape works for `highlight.js`, Prism, CodeMirror, etc. — render
synchronously into the `foreign` element's node, or hydrate asynchronously as above.

## Security

| Concern                      | Default                                    | Opt-in                                                     |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Raw HTML (`<div>`)           | Dropped                                    | `sanitizeHtml: (html) => string` → result injected as HTML |
| `javascript:` / `data:` URLs | Neutralized (link → text, image → dropped) | add the scheme to `allowedProtocols`                       |
| Link rewriting               | —                                          | `transformLink: (href, node) => string \| null`            |

There is intentionally no "render raw HTML unsanitized" switch. To render raw
HTML, supply `sanitizeHtml` — a function that takes the raw HTML and returns a
sanitized string (e.g. wrap [DOMPurify](https://github.com/cure53/DOMPurify)).
The result is injected verbatim, so the sanitizer owns safety; without it, raw
HTML is dropped.

`allowedProtocols` defaults to `['http', 'https', 'mailto', 'tel']`. Relative
URLs, query strings and `#anchors` are always allowed.

## Options

| Option             | Type                                | Default               |
| ------------------ | ----------------------------------- | --------------------- |
| `gfm`              | `boolean`                           | `true`                |
| `renderers`        | `Renderers`                         | —                     |
| `extensions`       | micromark extensions                | —                     |
| `mdastExtensions`  | mdast extensions                    | —                     |
| `sanitizeHtml`     | `(html: string) => string`          | — (raw HTML dropped)  |
| `allowedProtocols` | `string[]`                          | http/https/mailto/tel |
| `transformLink`    | `(href, node) => string \| null`    | —                     |
| `class`            | `string`                            | `'markdown-body'`     |
| `keyOf`            | `(node, index) => string \| number` | content hash          |

### `keyOf`

By default each top-level block is keyed by a hash of its source — optimal for
streaming. Override `keyOf` to give blocks **stable identity** across edits (e.g.
for block-level transitions): each block is then wrapped in a stable
`div.markdown-block` whose contents rebuild in place when the block's source
changes.

## Lower-level API

```ts
import { parseMarkdown, renderMarkdown } from '@llui/markdown'

const root = parseMarkdown('# Hi') // mdast Root
const nodes = renderMarkdown(root) // Renderable (snapshot, non-reactive)
```

Also exported: `defaultRenderers`, `mergeRenderers`, `sanitizeUrl`, `resolveUrl`,
`toKeyedBlocks`, `makeContext`, `collectDefinitions`, `resolveOptions`.

## License

MIT
