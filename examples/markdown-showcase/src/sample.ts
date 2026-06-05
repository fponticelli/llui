// A rich Markdown document exercising the full CommonMark + GFM surface, used as
// the editor's starting content and the source for the streaming demo.

export const SAMPLE = `# LLui Markdown

Reactive Markdown rendering — parsed to an **mdast** AST and rendered as *real
reactive DOM*, never an HTML string. Edit on the left; the preview updates live.

## Why it's different

- No virtual DOM — blocks become real nodes once.
- Top-level blocks are **content-hash-keyed**, so streaming output reuses
  unchanged blocks and only rebuilds the changing tail.
- Safe by default: raw HTML and \`javascript:\` URLs are neutralized.

> "The best Markdown renderer is the one that disappears." — _someone, probably_

### GitHub Flavored Markdown

A task list:

- [x] Parse to mdast (micromark)
- [x] Render via LLui authoring helpers
- [ ] ~~Ship a virtual DOM~~ (never)

A table with alignment:

| Feature       | Status |     Notes |
| :------------ | :----: | --------: |
| Tables        |   ✅   |       GFM |
| Strikethrough |   ✅   |  \`~~x~~\` |
| Autolinks     |   ✅   | https://llui.dev |

### Code

Fenced code keeps its language for highlighting:

\`\`\`ts
import { markdown } from '@llui/markdown'

// state.at('source') is a Signal<string> — the view reacts to it.
view: ({ state }) => [markdown(state.at('source'))]
\`\`\`

Inline \`code\` works too, and so do [links](https://github.com/fponticelli/llui)
and footnotes.[^1]

---

Made with LLui.

[^1]: Footnotes are part of GFM and render as references.
`
