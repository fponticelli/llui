# @llui/markdown-editor

WYSIWYG Markdown editor for [LLui](https://github.com/fponticelli/llui) — hides Markdown behind a rich, pluggable editing widget built on Lexical.

```bash
pnpm add @llui/markdown-editor @llui/lexical @llui/components lexical
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

## What it provides

- **`markdownEditor()`** — the editor component, built on the [`@llui/lexical`](https://www.npmjs.com/package/@llui/lexical) seam.
- **Transformer registry** — GFM and callout plugins (`./plugins/core`, `./plugins/callout`) that map Markdown constructs to Lexical nodes.
- **Toolbar surface** — an optional formatting toolbar (`./surfaces/toolbar`).
- **`collab` seam** — opt-in collaborative editing via [`@llui/lexical-collab`](https://www.npmjs.com/package/@llui/lexical-collab).

## Entry points

| Import                                    | Purpose                        |
| ----------------------------------------- | ------------------------------ |
| `@llui/markdown-editor`                   | `markdownEditor()` component   |
| `@llui/markdown-editor/plugins/core`      | Core GFM transformers          |
| `@llui/markdown-editor/plugins/callout`   | Callout/admonition transformer |
| `@llui/markdown-editor/surfaces/toolbar`  | Toolbar surface                |
| `@llui/markdown-editor/styles/editor.css` | Editor styles                  |

Peers on `@llui/dom`, `@llui/lexical`, `@llui/components`, `lexical`, and the relevant `@lexical/*` packages (`^0.46`).
