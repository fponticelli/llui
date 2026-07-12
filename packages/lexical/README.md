# @llui/lexical

Low-level binding between [Lexical](https://lexical.dev) and the [LLui](https://github.com/fponticelli/llui) signal runtime.

```bash
pnpm add @llui/lexical lexical
```

## What it provides

- **`lexicalForeign`** — a `foreign()` seam that mounts a Lexical editor inside an LLui view while keeping the editor's imperative lifecycle isolated from the runtime's reconciler.
- **Plugin contract** — a small interface for registering Lexical plugins (history, rich-text, selection, …) against the mounted editor.
- **DecoratorNode ↔ LLui bridge** — render an LLui sub-view inside a Lexical `DecoratorNode`, so decorator content participates in the same TEA update cycle as the surrounding app.

This is the plumbing layer. For a batteries-included editor see [`@llui/markdown-editor`](https://www.npmjs.com/package/@llui/markdown-editor); for collaborative editing see [`@llui/lexical-collab`](https://www.npmjs.com/package/@llui/lexical-collab).

## Peer dependencies

`@llui/dom`, `lexical`, and the `@lexical/{history,rich-text,selection,utils}` packages (all `^0.46`) are peers — install the ones your integration uses.
