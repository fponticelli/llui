# @llui/markdown-editor

WYSIWYG Markdown editor for [LLui](https://github.com/fponticelli/llui) — hides Markdown behind a rich, pluggable editing widget built on Lexical.

```bash
pnpm add @llui/markdown-editor @llui/lexical @llui/components @llui/interactions @llui/markdown @llui/dom lexical
```

## Usage

```ts
import { mountApp } from '@llui/dom'
import { markdownEditor } from '@llui/markdown-editor'
import '@llui/markdown-editor/styles/editor.css'

// `markdownEditor()` returns a component definition; mount it (or compose it).
mountApp(
  document.getElementById('editor')!,
  markdownEditor({
    defaultValue: '# Hello\n\nStart typing…',
    toolbar: true,
    onChange: (markdown) => console.log(markdown),
  }),
)
```

## Reading and writing the document

`onChange(markdown)` fires when the **document** changes — a commit that leaves
the serialized Markdown identical (a caret move, or re-typing the same text) is
not reported, so a consumer needs no dedupe of its own.

Push a new document with `send({ type: 'setValue', value })`. That is the only
sanctioned write path: the `@llui/lexical` seam decides whether the value would
actually change the document and skips the write when it would not, which is why
a controlled loop that re-authors the Markdown in its own surface style (`_em_`
where the editor emits `*em*`) does not reset the caret on every keystroke.
`onReady(editor)` hands you the raw `LexicalEditor` for command dispatch; writing
Markdown into it directly bypasses that decision and re-opens the echo loop.

## What it provides

- **`markdownEditor()`** — the editor component, built on the [`@llui/lexical`](https://www.npmjs.com/package/@llui/lexical) seam.
- **Transformer registry** — GFM and callout plugins (`./plugins/core`, `./plugins/callout`) that map Markdown constructs to Lexical nodes.
- **Toolbar surface** — an optional formatting toolbar (`./surfaces/toolbar`).
- **`collab` seam** — opt-in collaborative editing via [`@llui/lexical-collab`](https://www.npmjs.com/package/@llui/lexical-collab).

The core list importer follows the parent item's Markdown content column rather
than assuming a fixed four-space indent. Nested bullet, ordered, and task lists
therefore accept CommonMark's marker-dependent indentation, including tabs and
multi-digit ordered markers, while indented code remains literal item content.

## Entry points

| Import                                    | Purpose                        |
| ----------------------------------------- | ------------------------------ |
| `@llui/markdown-editor`                   | `markdownEditor()` component   |
| `@llui/markdown-editor/plugins/core`      | Core GFM transformers          |
| `@llui/markdown-editor/plugins/callout`   | Callout/admonition transformer |
| `@llui/markdown-editor/plugins/table`     | `tablePlugin()` — GFM tables   |
| `@llui/markdown-editor/surfaces/toolbar`  | Toolbar surface                |
| `@llui/markdown-editor/styles/editor.css` | Editor styles                  |

Peers on `@llui/dom`, `@llui/lexical`, `@llui/components`, `@llui/interactions`,
`@llui/markdown`, `lexical`, and the relevant `@lexical/*` packages (`^0.49`). Resolve one
instance of DOM and interactions across the host and editor so render context and overlay
ownership stay shared.

`@lexical/table` is an **optional** peer. It is imported by exactly one module —
the table plugin — which is why that plugin is _not_ re-exported from the barrel:

```ts
import { tablePlugin } from '@llui/markdown-editor/plugins/table'
```

An editor without tables neither installs nor bundles `@lexical/table`.
