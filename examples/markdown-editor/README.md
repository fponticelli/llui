# LLui Markdown Editor — demo

A live showcase of [`@llui/markdown-editor`](../../packages/markdown-editor) (built on
[`@llui/lexical`](../../packages/lexical)): a WYSIWYG editor that hides Markdown behind a rich,
pluggable widget.

```bash
pnpm --filter @llui/example-markdown-editor dev
```

## What it shows

1. **Full editor** — the default toolbar (`markdownEditor({ toolbar: true })`) plus the GFM core
   plugin and a custom **callout** decorator. A side panel mirrors the live Markdown and reports
   word/char counts; a row of buttons drives the editor entirely through its public component
   handle (`send`/`subscribe`/`getState`) — the same surface an agent would use.

2. **Minimal editor** — the _same_ component with no chrome: keyboard-only Markdown shortcuts
   (`**bold**`, `# heading`, `- list`). Demonstrates that one component scales from minimal to full.

3. **Single block (inline-only)** — `singleBlockPlugin()` constrains the editor to one paragraph
   with inline styles only (no headings/lists/blocks). A strict single-line **title field** (Enter
   inert; pasted blocks collapse to a line) and a **comment box** with `allowLineBreaks: true` +
   `link: true` composed with `linkPlugin()`. Each mirrors its live Markdown.

4. **Two-way Markdown source** — a raw `<textarea>` bound to the WYSIWYG view through the handle
   (`setValue` in, `onChange` out, echo-suppressed). Edit either side; they stay in sync.

## Highlights

- **Markdown is the only I/O.** Lexical's editor state never leaks past the widget.
- **Pluggable.** `corePlugin()` ships the GFM superset; `calloutPlugin()` adds a custom block node,
  a Markdown transformer (`:::kind text`), and an LLui sub-view rendered _inside_ the document.
- **Custom rendering.** Each callout is an independent LLui component (its own TEA loop) mounted in
  a Lexical `DecoratorNode`. Click a callout's badge to cycle its kind — the change round-trips
  straight back to Markdown.
- **Idiomatic LLui.** Reactive bindings, effects-as-data, and the `connect()`/parts toolbar idiom.
