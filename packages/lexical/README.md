# @llui/lexical

Low-level binding between [Lexical](https://lexical.dev) and the [LLui](https://github.com/fponticelli/llui) signal runtime.

```bash
pnpm add @llui/lexical lexical
```

## What it provides

- **`lexicalForeign`** — a `foreign()` seam that mounts a Lexical editor inside an LLui view while keeping the editor's imperative lifecycle isolated from the runtime's reconciler.
- **Plugin contract** — a small interface for registering Lexical plugins (history, rich-text, selection, …) against the mounted editor.
- **DecoratorNode ↔ LLui bridge** — render an LLui sub-view inside a Lexical `DecoratorNode`, so decorator content participates in the same TEA update cycle as the surrounding app.
- **The commit hub** — one shared `registerUpdateListener` and one editor-state read per commit, serving every plugin that only needs to know where the selection is.

### The commit hub

A plugin that reacts to the caret subscribes with `ctx.onCommit(facts => …)` instead of registering its own update listener. One listener, one `editorState.read()`, one caret measurement and one shared ancestor walk serve every subscriber — six overlay plugins in `@llui/markdown-editor` cost what one used to.

The callback runs **inside** the shared read, so bare `$` helpers are free and writes are forbidden; `ctx.emit` from there is buffered and delivered once the read has closed, which is what keeps read-then-dispatch out of the plugin contract. `ctx.withFacts(fn)` derives the same facts on demand, for the scroll/resize path where geometry moved but the document did not. `facts.selectionOnly` marks a commit that dirtied no node — an element-anchored overlay can skip its `getBoundingClientRect` outright.

A commit is **batched**: every subscriber refreshes first, then every buffered emission drains in subscription order. Do not write a plugin that depends on a sibling's message having been reduced by the time yours runs.

`lexicalForeign` builds the hub and hands it to each plugin as the `PluginContext`. **Breaking:** `PluginContext` therefore now carries `onCommit` and `withFacts` as well as `emit` — code that hand-rolled a `{ emit }` context (tests, custom hosts) should call `createCommitHub(editor, emit)` instead.

#### What `selectionOnly` costs

Skipping the measurement on a caret-only commit is a real behavioural trade, not
a free win. An element-anchored overlay now re-measures on a **dirtying commit**
or on the host's **scroll/resize** listener, and on nothing else. A layout shift
that is neither — a sibling element growing, a webfont swapping in, an image
above the editor finishing its load — leaves such an overlay at a stale position
until the next dirtying commit, where previously any caret move happened to
correct it. That accidental correction is what the gate removes. A host that
needs more should drive `ctx.withFacts` from whatever observes its own layout
(e.g. a `ResizeObserver`).

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
