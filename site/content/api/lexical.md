---
title: '@llui/lexical'
description: 'Low-level binding between Lexical and the LLui signal runtime — mount Lexical via foreign(), a plugin contract, and the DecoratorNode ↔ LLui sub-view bridge.'
---

# @llui/lexical

The seam between [Lexical](https://lexical.dev) (Meta's extensible text-editor framework) and the LLui signal runtime. It mounts a Lexical editor as a [`foreign()`](/api/dom) island inside an LLui view, defines a small plugin contract so editor behavior composes the same way LLui views do, and bridges Lexical `DecoratorNode`s to LLui sub-views so rich embeds (callouts, math, images, …) are authored as ordinary LLui components.

This is the low-level layer. If you want a ready-made WYSIWYG editor, reach for [`@llui/markdown-editor`](/api/markdown-editor), which is built on top of this package. Use `@llui/lexical` directly when you are building your own editor surface or a custom node type.

```bash
pnpm add @llui/lexical @llui/dom lexical
```

`lexical` is a peer dependency — you bring the Lexical version you want.

## The three seams

- **`lexicalForeign(opts)`** — wraps a Lexical editor as an LLui `foreign()` mountable. LLui owns the host node; Lexical owns everything inside it. Editor output (selection/format changes, content edits) flows back out as messages, so the surrounding LLui component reacts with the normal `update`/`view` cycle.
- **Plugin contract** (`LexicalPlugin`, `PluginContext`, `decoratorBridge`, `registerShortcuts`) — a plugin receives a `PluginContext` (the editor, a shortcut registrar, a decorator-bridge factory) and registers commands, nodes, and key bindings. Plugins are plain values you compose into a list, mirroring how LLui structural primitives compose.
- **Decorator bridge** (`LLuiDecoratorNode`, `registerDecoratorBridges`, `DecoratorBridge`) — a Lexical `DecoratorNode` whose rendered body is an LLui sub-view. Author an embed once as an LLui component; the bridge mounts/unmounts it as Lexical inserts and removes the node.

## Reading selection state

`readBaseFormat` / `$readBaseFormat` collapse the active Lexical selection into a plain, serializable `BaseFormat` (block type, alignment, bold/italic/…) — the shape a toolbar binds to. The `$`-prefixed variant runs inside a Lexical read transaction; the unprefixed one wraps that for you.

## API

<!-- auto-api:start -->

## Functions

### `$createLLuiDecoratorNode()`

Create a decorator node for `bridgeType` carrying `data`.

```typescript
function $createLLuiDecoratorNode(bridgeType: string, data: unknown): LLuiDecoratorNode
```

### `$isLLuiDecoratorNode()`

```typescript
function $isLLuiDecoratorNode(node: LexicalNode | null | undefined): node is LLuiDecoratorNode
```

### `$readBaseFormat()`

Read the base format at the current selection. Must run inside a Lexical
read/update context (it calls `$`-prefixed APIs).

```typescript
function $readBaseFormat(): BaseFormat
```

### `createWidgetRuntime()`

Build the widget runtime for a set of registrations.
Called by `lexicalForeign` ONLY when at least one widget is registered — when
none are, `createEditor` is invoked exactly as it was before this seam
existed, so every existing consumer sees zero behaviour change and zero
exposure to the experimental APIs above.

```typescript
function createWidgetRuntime(widgets: readonly NodeWidget[]): WidgetRuntime
```

### `decoratorBridge()`

Author-facing constructor for a {@link DecoratorBridge}. The `view` builder
receives a REACTIVE `Signal<Data>` (not a snapshot) plus the node api, and
returns the sub-view's DOM. The bridge wraps it in a tiny host component whose
single state field IS the data, so a later `mount.update(next)` simply drives
that signal — the sub-view re-renders in place, never remounting (the fix for
focus/selection loss on every data commit). `Data` is narrowed from the node's
serialized payload at mount (the single deserialization-boundary cast, exactly
like `JSON.parse` returning a declared type).

```typescript
function decoratorBridge<Data>(
  type: string,
  view: (data: Signal<Data>, api: DecoratorApi<Data>) => Renderable,
): DecoratorBridge
```

### `isMacPlatform()`

Best-effort macOS detection (browser only; defaults to false off-DOM).

```typescript
function isMacPlatform(): boolean
```

### `isNodeWidgetHost()`

True when `el` is a widget host produced by this seam. Exported so a
consumer (or a test) can assert overlay-vs-document without reaching for the
experimental `isDOMUnmanaged` itself.

```typescript
function isNodeWidgetHost(el: Node): boolean
```

### `lexicalForeign()`

Mount Lexical into an LLui view. Returns a `Mountable` placed in the view
array; Lexical is created on mount and destroyed on the component's dispose.

```typescript
function lexicalForeign<Emit = unknown>(opts: LexicalForeignOptions<Emit>): Mountable
```

### `matchesCombo()`

Does a keyboard event satisfy a parsed chord? `mod` maps to ⌘ on macOS and
Ctrl elsewhere; all four modifier keys must match the resolved requirement
exactly (no extras held).

```typescript
function matchesCombo(event: KeyboardEvent, combo: ParsedCombo, isMac: boolean): boolean
```

### `nodeWidget()`

Author-facing constructor for a {@link NodeWidget}.
It exists for inference: `Source` is inferred from `source` and flows into
`render`, `equals`, and `decorateHost` without the caller writing any type
parameters. The returned descriptor is type-erased (the registry is
monomorphic); the casts below are the single erasure boundary, and they are
sound because `WidgetContext` is covariant in `N` and each callback only ever
receives back the values this same spec produced.

```typescript
function nodeWidget<N extends LexicalNode, Source>(spec: WidgetSpec<N, Source>): NodeWidget
```

### `parseCombo()`

Parse a chord like `Mod-Shift-7` into its parts. Case-insensitive on
modifiers; the final segment is the key (lower-cased for letters).

```typescript
function parseCombo(combo: string): ParsedCombo
```

### `readBaseFormat()`

Convenience wrapper that opens a read context on `editor`.

```typescript
function readBaseFormat(editor: LexicalEditor): BaseFormat
```

### `registerDecoratorBridges()`

Wire decorator bridges onto an editor: register the bridge registry, place
each decoration element into its node's DOM, and dispose sub-apps when their
nodes are destroyed. Returns a disposer that tears down all live sub-apps.
Typically called from a plugin's `register`.

```typescript
function registerDecoratorBridges(
  editor: LexicalEditor,
  bridges: readonly DecoratorBridge[],
): () => void
```

### `registerShortcuts()`

Register a set of shortcuts on the editor through one KEY_DOWN handler.
Returns a disposer. The first matching shortcut whose `run` returns `true`
wins and the event is consumed.

```typescript
function registerShortcuts(editor: LexicalEditor, shortcuts: readonly ShortcutSpec[]): () => void
```

## Types

### `Alignment`

```typescript
export type Alignment = 'left' | 'center' | 'right' | 'justify' | 'start' | 'end' | null
```

### `BaseBlockType`

Block kinds resolvable without list/code packages. Anything else → 'other',
which the markdown layer refines (list, code, …).

```typescript
export type BaseBlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'other'
```

### `SerializedLLuiDecoratorNode`

```typescript
export type SerializedLLuiDecoratorNode = Spread<
  { bridgeType: string; data: unknown },
  SerializedLexicalNode
>
```

### `WidgetPlacement`

Where a widget's DOM sits relative to the host node's lexical-managed
children.
`'tail'` — after every managed child (the default, and the safe choice).
`'head'` — before every managed child.
There is deliberately no third value: an interleaved widget would skew
`ElementDOMSlot.resolveChildIndex`, which counts raw `childNodes`, and
mis-place the caret on click. See the header, clobbering path 2.

```typescript
export type WidgetPlacement = 'head' | 'tail'
```

## Interfaces

### `BaseFormat`

The generic format surface at the current selection.

```typescript
export interface BaseFormat {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
  code: boolean
  blockType: BaseBlockType
  alignment: Alignment
  /** The resolved top-level block element key (lets the markdown layer refine). */
  blockKey: string | null
  hasSelection: boolean
  isCollapsed: boolean
}
```

### `DecoratorApi`

Imperative handle a decorator sub-view uses to talk to its Lexical node.

```typescript
export interface DecoratorApi<Data> {
  /** Persist new node data (writes into the Lexical node → markdown-serializable). */
  update: (next: Data) => void
  /** The owning Lexical editor (for dispatching commands, reading state). */
  editor: LexicalEditor
}
```

### `DecoratorBridge`

Bridges a custom node type to an LLui sub-view. The sub-view's `Data` type is
erased here: a bridge is stored monomorphically in the registry, and `mount`
builds + mounts the sub-app ONCE, returning a {@link DecoratorMount} whose
`update` channel reactively pushes later data changes in place. Authors
construct bridges with the typed {@link decoratorBridge} helper.

```typescript
export interface DecoratorBridge {
  /** The id used by the contributing markdown transformer. */
  type: string
  /** Mount the sub-view for a node's (deserialized) data ONCE; returns a live
   * {@link DecoratorMount} (dispose + reactive data-push). */
  mount: (container: Element, data: unknown, api: DecoratorApi<unknown>) => DecoratorMount
}
```

### `LexicalForeignOptions`

```typescript
export interface LexicalForeignOptions<Emit = unknown> {
  /** Editor namespace (instance isolation; required for distinct editors). */
  namespace: string
  theme?: EditorThemeClasses
  /** Node classes registered in addition to the plugins' own nodes. */
  nodes?: ReadonlyArray<LexicalNodeConfig>
  /** Plugins: their `nodes` are merged, `register`/`shortcuts` wired at mount. */
  plugins?: ReadonlyArray<LexicalPlugin<Emit>>
  /** Non-document overlay DOM registrations, composed with the plugins' own
   * `widgets`. See {@link nodeWidget}. When the composed list is EMPTY the
   * editor is created exactly as it was before this option existed — no
   * render-config override, no experimental API in play. */
  widgets?: ReadonlyArray<NodeWidget>
  /** Serialize the live document → string (runs in a read context). */
  serialize: (editor: LexicalEditor) => string
  /** Deserialize a string into the document (runs in an update context). */
  deserialize: (editor: LexicalEditor, value: string) => void
  /** Initial document (uncontrolled) — ignored when `value` is provided. */
  defaultValue?: string
  /** Controlled document signal; the editor follows it (echo-guarded). */
  value?: Signal<string>
  /** Reactive read-only flag (always supplied by the host's state). */
  readonly: Signal<boolean>
  /** Debounce window (ms) for outbound serialization. Default 300. */
  changeDebounceMs?: number
  /** Register the built-in `@lexical/history` undo stack. Default `true`.
   * Set `false` when an external owner provides history (e.g. a CRDT undo
   * manager in collab mode) — a local stack would shadow it and cross peers.
   * Prefer {@link ForeignOptions.externalUndo} over setting this manually:
   * it owns undo AND disables the built-in stack in one place, so the two
   * can't both be live. */
  history?: boolean
  /** An external owner of the undo/redo stack (e.g. `@llui/lexical-collab`'s
   * CRDT undo manager). When set, the built-in `@lexical/history` stack is
   * **forced off** — so a collab consumer cannot accidentally run both and
   * double-apply undo (the conflict is unrepresentable, not a doc footnote).
   * Registered after rich-text like {@link ForeignOptions.register}; return
   * a disposer. Setting `externalUndo` together with `history: true` is a
   * configuration error and is reported. */
  externalUndo?: (editor: LexicalEditor) => () => void
  /** When the document is seeded. `'auto'` (default) seeds from
   * `value`/`defaultValue` at mount. `'deferred'` skips the boot-time seed so an
   * external owner controls it (e.g. collab seeds once, gated on provider sync,
   * only if the shared doc is still empty). */
  seedMode?: 'auto' | 'deferred'
  /** Outbound: serialized document changed (debounced, real edits only). */
  onChange?: (value: string) => void
  /** Outbound: selection / format / structure changed (every commit). */
  onSelectionChange?: (ctx: SelectionContext) => void
  /** Host emit, handed to each plugin's `register` context. */
  emit?: (msg: Emit) => void
  /** Receives the live editor at mount (host dispatches commands through it). */
  onReady?: (editor: LexicalEditor) => void
  /** Extra registration after rich-text (e.g. markdown shortcuts). Disposer. */
  register?: (editor: LexicalEditor) => () => void
  onError?: (error: Error) => void
}
```

### `LexicalPlugin`

A composable unit of editor behaviour.

```typescript
export interface LexicalPlugin<Emit = unknown> {
  /** Stable identifier (also used for de-duplication and overrides). */
  name: string
  /**
   * Lexical node classes registered on the editor config.
   *
   * `LexicalNodeConfig` — not `Klass<LexicalNode>` — so a plugin can register
   * the `{ replace, with, withKlass }` replacement form. Subclassing a built-in
   * node (e.g. to reserve a DOM slot boundary via `getDOMSlot`) is only
   * expressible that way, and the runtime already passes these straight to
   * `createEditor`.
   */
  nodes?: ReadonlyArray<LexicalNodeConfig>
  /** Imperative registration (commands, listeners). Returns a disposer. */
  register?: (editor: LexicalEditor, ctx: PluginContext<Emit>) => () => void
  /** Keyboard shortcuts wired through a single KEY_DOWN command. */
  shortcuts?: readonly ShortcutSpec[]
  /** Decorator bridges this plugin owns. */
  decorators?: readonly DecoratorBridge[]
  /**
   * Non-document overlay DOM this plugin attaches to node types — computed
   * results, badges, ghosts. Unlike `decorators`, a widget is NOT a node: it is
   * never serialized, never in the undo stack, never in the clipboard. See
   * {@link nodeWidget}.
   */
  widgets?: readonly NodeWidget[]
}
```

### `NodeWidget`

An opaque widget registration, contributed via `lexicalForeign({ widgets })`
or a plugin's `widgets` field.

```typescript
export interface NodeWidget {
  readonly id: string
  /** @internal */ readonly __spec: ErasedWidgetSpec
}
```

### `ParsedCombo`

A parsed chord. `mod` means ⌘ on macOS / Ctrl elsewhere.

```typescript
export interface ParsedCombo {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
}
```

### `PluginContext`

Context handed to `plugin.register` so a plugin can talk back to the host
(e.g. open a slash menu) without owning the host's `send`. `Emit` is the
host message type; `@llui/lexical` leaves it `unknown`, hosts narrow it.

```typescript
export interface PluginContext<Emit = unknown> {
  /** Emit a host message into the embedding component's update loop. */
  emit: (msg: Emit) => void
}
```

### `SelectionContext`

Context handed to the selection callback on every commit.

```typescript
export interface SelectionContext {
  editor: LexicalEditor
  canUndo: boolean
  canRedo: boolean
}
```

### `ShortcutSpec`

A keyboard shortcut bound to an editor action.
`combo` is a normalized chord: `Mod` resolves to ⌘ on macOS and Ctrl
elsewhere, e.g. `Mod-b`, `Mod-Shift-7`, `Mod-Alt-1`. `run` returns `true`
when it handled the event (which stops propagation / prevents default).

```typescript
export interface ShortcutSpec {
  combo: string
  run: (editor: LexicalEditor) => boolean
}
```

### `WidgetContext`

Everything a widget renderer is told about its host.

```typescript
export interface WidgetContext<N extends LexicalNode> {
  /** The host node. Read inside the active editor state (the runtime calls
   * every hook from inside the reconciler, so `$`-prefixed reads are legal). */
  readonly node: N
  /** The host node's key. Stable for the node's lifetime — the identity a
   * consumer should key a memo cache by. */
  readonly key: NodeKey
  readonly editor: LexicalEditor
}
```

### `WidgetDisposeContext`

What a widget's `dispose` is told. No `node`: teardown most often fires
because the node was destroyed.

```typescript
export interface WidgetDisposeContext {
  readonly key: NodeKey
  readonly editor: LexicalEditor
}
```

### `WidgetRuntime`

What {@link createWidgetRuntime} hands back to `lexicalForeign`.

```typescript
export interface WidgetRuntime {
  /** Passed straight to `createEditor({ dom })`. `CreateEditorArgs.dom` is a
   * `Partial<EditorDOMRenderConfig>` spread over `DEFAULT_EDITOR_DOM_CONFIG`
   * (LexicalEditor.ts:1037-1041), so supplying only these two members leaves
   * the other seven at their defaults. */
  readonly domConfig: Partial<EditorDOMRenderConfig>
  /** Wire teardown for the given editor. Call BEFORE `setRootElement` (the
   * first reconcile). Returns a disposer. */
  attach: (editor: LexicalEditor) => () => void
}
```

### `WidgetSpec`

A widget's rendering contract.
The `source` / `equals` / `render` split is load-bearing, not ceremony. The
tempting thinner API — `(node) => HTMLElement | null` — gives the runtime no
way to know whether a rebuild is NEEDED, so every reconcile of the host would
allocate a subtree and run the consumer's (possibly expensive) computation;
and a fresh element every commit destroys the widget's own DOM state (scroll
position in a wide result table, a focused cell). Here `source` is the cheap
pure projection, `equals` is the gate, and `render` mutates a STABLE host.
Same shape, and same reason, as `DecoratorMount.update`.
Neither `source` nor `render` may throw: they run inside Lexical's reconciler,
where an exception aborts the commit mid-flight.

```typescript
export interface WidgetSpec<N extends LexicalNode, Source> {
  /** Debug/dedup id; also the value of the host element's `data-llui-widget`.
   * Records are keyed by `${nodeKey}:${id}`, so several widgets may attach to
   * one node as long as their ids differ. */
  readonly id: string

  /** The Lexical node class this widget attaches to. Matched with `instanceof`,
   * so a `{ replace, with, withKlass }` replacement subclass still matches its
   * base klass without any extra resolution. */
  readonly klass: Klass<N>

  /**
   * Derive the widget's INPUT from the node. Runs inside the active editor
   * state on every reconcile of the host. MUST be pure and cheap — it is the
   * gate that makes unrelated edits free.
   *
   * Return `null` for "this node has no widget right now": any existing host is
   * removed and `dispose` runs.
   */
  readonly source: (ctx: WidgetContext<N>) => Source | null

  /** Equality on `Source`. Default `Object.is`. When it holds against the last
   * render's source, `render` is SKIPPED entirely. */
  readonly equals?: (a: Source, b: Source) => boolean

  /**
   * Build/refresh the widget DOM. Called only when the source changed.
   *
   * `host` is a stable, runtime-owned element that is already marked unmanaged,
   * already `contenteditable=false`, and already positioned at the placement
   * boundary. The renderer owns only `host`'s CHILDREN and may
   * `replaceChildren(...)` freely; it must not move or unparent `host` itself.
   */
  readonly render: (host: HTMLElement, source: Source, ctx: WidgetContext<N>) => void

  /**
   * OPTIONAL: style the host node's own DOM in the same pass.
   *
   * Overlay DOM covers "render a computed result"; it does not cover "highlight
   * the source span that produced it" (ProseMirror's `Decoration.inline`). The
   * alternative — a node transform writing `style`/format onto the node — is a
   * DOCUMENT MUTATION and would round-trip into the serialized output, which is
   * exactly what this seam exists to avoid. So the escape hatch lives here.
   *
   * Unlike `render` this runs on EVERY decorate pass, including when `source` is
   * `null` and including when the source is unchanged — because `dom` may be a
   * brand-new element (the `$updateDOM` replacement path) that has none of the
   * previous element's classes. Keep it idempotent, e.g. `classList.toggle`.
   */
  readonly decorateHost?: (dom: HTMLElement, source: Source | null, ctx: WidgetContext<N>) => void

  /** Placement. Default `'tail'`. */
  readonly placement?: WidgetPlacement

  /** Extra classes on the host element (the runtime always adds
   * `llui-node-widget`). */
  readonly className?: string

  /** Tag for the widget host element. Defaults to `'span'` when the node
   * reports `isInline()`, `'div'` otherwise — so an inline widget cannot
   * illegally nest a block element inside a `<span>`. */
  readonly tag?: keyof HTMLElementTagNameMap

  /** Torn down when the host node is destroyed, when `source` goes `null`, or
   * when the editor disposes. Use it to release listeners the renderer attached
   * inside `host`.
   *
   * Its context deliberately omits `node`: the commonest teardown trigger is the
   * node's DESTRUCTION, at which point no node instance exists to hand back.
   * Making that unrepresentable beats handing over a stale or fabricated one. */
  readonly dispose?: (host: HTMLElement, ctx: WidgetDisposeContext) => void
}
```

## Classes

### `LLuiDecoratorNode`

A generic decorator node that mounts an LLui sub-view via a registered
{@link DecoratorBridge}.

```typescript
class LLuiDecoratorNode extends DecoratorNode<HTMLElement> {
  __bridgeType: string
  __data: unknown
  getType(): string
  clone(node: LLuiDecoratorNode): LLuiDecoratorNode
  constructor(bridgeType: string, data: unknown, key?: NodeKey)
  createDOM(_config: EditorConfig): HTMLElement
  updateDOM(): false
  isInline(): false
  importDOM(): DOMConversionMap | null
  getBridgeType(): string
  getData(): unknown
  setData(data: unknown): void
  decorate(editor: LexicalEditor): HTMLElement
  exportJSON(): SerializedLLuiDecoratorNode
  importJSON(json: SerializedLLuiDecoratorNode): LLuiDecoratorNode
  updateFromJSON(json: LexicalUpdateJSON<SerializedLLuiDecoratorNode>): this
}
```

## Constants

### `PROGRAMMATIC_TAG`

Lexical update tag marking a programmatic write (seed / controlled setValue),
so the outbound change listener doesn't echo it back to the host.

```typescript
const PROGRAMMATIC_TAG
```

### `WIDGET_ATTR`

The attribute carrying the widget's `id` on its host element.

```typescript
const WIDGET_ATTR
```

### `WIDGET_CLASS`

The class the runtime always stamps on a widget host, so an app can style
every widget (and a test can find them) without knowing each id.

```typescript
const WIDGET_CLASS
```

<!-- auto-api:end -->

## Related

- [`@llui/markdown-editor`](/api/markdown-editor) — the WYSIWYG editor built on this seam.
- [`@llui/dom`](/api/dom) — `foreign()`, the imperative-library mounting primitive this package builds on.
- [Lexical documentation](https://lexical.dev) — the underlying editor framework.
