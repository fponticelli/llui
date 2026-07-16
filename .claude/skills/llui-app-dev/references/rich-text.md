# Markdown + rich-text editing

## Reactive Markdown (@llui/markdown)

`markdown(source, options?)` renders CommonMark+GFM to **live reactive DOM** — it parses
to mdast and builds real nodes (no HTML string), so it's XSS-safe by default (raw HTML is
dropped unless you supply a `sanitizeHtml` hook). The source is `Reactive<string>`, so it
updates as state changes.

```ts
import { markdown, defaultRenderers, type Renderers } from '@llui/markdown'

view: ({ state }) => [div({ class: 'doc' }, [markdown(state.at('source'))])]
```

- **Streaming-friendly:** top-level blocks are content-hash-keyed, so appending to `source` (an LLM streaming tokens) reuses unchanged blocks instead of rebuilding the document. Just keep pushing to `state.source`.
- **Custom renderers** merge over `defaultRenderers` per node type:

```ts
const renderers: Renderers = {
  heading: (node, ctx) => [
    /* wrap or extend defaultRenderers.heading(node, ctx) */
  ],
  link: (node, ctx) => [a({ href: node.url, target: '_blank' }, ctx.renderChildren(node))],
}
markdown(state.at('source'), { renderers })
```

- `MarkdownOptions`: `{ gfm?, renderers?, sanitizeHtml?, allowedProtocols?, transformLink?, class?, keyOf?, … }`. A GFM-free (smaller) build is at `@llui/markdown/commonmark`.
- Link/image URLs are sanitized (scheme allowlist) via `@llui/security`. If you need to allow a scheme, use `allowedProtocols`, not a raw href.

### Review points

- Don't build an HTML string and pass it to `unsafeHtml` — use `markdown()` (safe, reactive, and it dedupes blocks). Reserve `unsafeHtml` for genuinely trusted HTML.
- Raw HTML in untrusted markdown is dropped unless a `sanitizeHtml` hook is supplied — that's the safe default; only add the hook with a real sanitizer.

## The WYSIWYG editor (@llui/markdown-editor)

`markdownEditor(config?)` returns an **ordinary LLui component** (`SignalComponentDef`) —
mount it with `mountApp`. Markdown is the source of truth; the editor is Lexical under the
hood via the `@llui/lexical` `foreign` seam.

```ts
import { mountApp } from '@llui/dom'
import { markdownEditor } from '@llui/markdown-editor'
import {
  corePlugin,
  linkPlugin,
  imagePlugin,
  tablePlugin,
  calloutPlugin,
} from '@llui/markdown-editor'

const app = mountApp(
  byId('editor'),
  markdownEditor({
    toolbar: true,
    plugins: [corePlugin(), linkPlugin(), imagePlugin(), tablePlugin(), calloutPlugin()],
    defaultValue: WELCOME_MD,
    changeDebounceMs: 150,
    onChange: (md) => {
      /* mirror out, e.g. to a hidden <textarea> */
    },
  }),
)
```

- **Drive it via the handle**, or embed it as a slice of a larger component:
  - `app.subscribe((s) => render(s))` — `EditorState` exposes `{ value, wordCount, charCount, dirty, readonly }`.
  - `app.send({ type: 'runCommand', id: 'bold' })`, `app.send({ type: 'setReadOnly', readonly: true })`, `app.send({ type: 'setValue', value })` (two-way binding).
- **Plugins are opt-in and tree-shake** — only bundle what you use: `corePlugin, linkPlugin, imagePlugin, tablePlugin, hrPlugin, mathPlugin, mermaidPlugin, mentionPlugin, emojiPlugin, calloutPlugin, slashPlugin, contextMenuPlugin, floatingToolbarPlugin, singleBlockPlugin`. Transformers are contributed by plugins (`buildTransformers`/`GFM_TRANSFORMERS`).

### Review points

- **`value` vs `onChange`:** the editor holds Markdown; get changes via `onChange` (config) or `app.subscribe`. Don't try to read the DOM.
- **Round-trip fidelity:** custom content plugins must round-trip (markdown → nodes → markdown) without loss or non-idempotence. Underline is intentionally absent (it can't round-trip to Markdown); `==highlight==` is non-GFM and opt-in only. If a feature silently disappears on serialize, it lacks a transformer.
- **The `foreign` lifecycle:** the editor is a `foreign` widget bridged to LLui. On unmount, the final debounced change is delivered to the consumer — don't route consumer delivery through a dying update loop. For custom Lexical integration see `@llui/lexical` (`lexicalForeign`, the DecoratorNode↔LLui sub-view bridge).

## Collaborative editing (@llui/lexical-collab)

Opt-in Yjs binding (`yjsCollab`) over an injected provider — CRDT sync, scoped undo,
presence cursors. The Yjs document is the source of truth and is persisted by whatever
provider the app injects. When the editor's node schema changes across versions, older
persisted documents can carry old node encodings — treat node-schema changes as a
versioned, migrated concern. This is niche; consult the package's own docs/types for the
provider contract before touching it.
