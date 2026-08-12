# @llui/lexical

Low-level binding between [Lexical](https://lexical.dev) and the [LLui](https://github.com/fponticelli/llui) signal runtime.

```bash
pnpm add @llui/lexical lexical
```

## What it provides

- **`lexicalForeign`** — a `foreign()` seam that mounts a Lexical editor inside an LLui view while keeping the editor's imperative lifecycle isolated from the runtime's reconciler.
- **Plugin contract** — a small interface for registering Lexical plugins (history, rich-text, selection, …) against the mounted editor.
- **DecoratorNode ↔ LLui bridge** — render an LLui sub-view inside a Lexical `DecoratorNode`, so decorator content participates in the same TEA update cycle as the surrounding app.

### Writing a value into the document

`lexicalForeign` is the sole authority on echo for the controlled value, in both
directions, and it answers one question in each: inbound, _would applying this
value change the live document?_; outbound, _does the document now serialize to
something the host doesn't have?_ So `onChange` does not fire for a commit that
leaves the serialized document unchanged, and a host push that describes the
document already on screen is not written (the caret survives).

Push through the `ForeignController` handed to `onReady(editor, controller)` —
`controller.applyValue(value)` returns whether the document was written. Writing
through the raw editor instead bypasses the authority, and the host owns the
resulting echo loop.

`serialize` and `deserialize` are called inside a read/update context that the
seam opens, so they may use bare `$` helpers.

This is the plumbing layer. For a batteries-included editor see [`@llui/markdown-editor`](https://www.npmjs.com/package/@llui/markdown-editor); for collaborative editing see [`@llui/lexical-collab`](https://www.npmjs.com/package/@llui/lexical-collab).

## Peer dependencies

`@llui/dom`, `lexical`, and the `@lexical/{history,rich-text,selection,utils}` packages (all `^0.46`) are peers — install the ones your integration uses.
