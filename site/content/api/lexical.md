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

### `decoratorBridge()`

Author-facing constructor for a {@link DecoratorBridge}. Preserves the
sub-component's `State`/`Msg`/`Effect` and the node `Data` type at the
definition site; only the node's serialized payload is narrowed back to
`Data` at mount time (the single deserialization-boundary cast, exactly like
`JSON.parse` returning a declared type).

```typescript
function decoratorBridge<Data, S, M extends { type: string }, E extends { type: string } = never>(
  type: string,
  factory: (data: Data, api: DecoratorApi<Data>) => SignalComponentDef<S, M, E>,
): DecoratorBridge
```

### `isMacPlatform()`

Best-effort macOS detection (browser only; defaults to false off-DOM).

```typescript
function isMacPlatform(): boolean
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

Bridges a custom node type to an LLui sub-view. The sub-view's
`State`/`Msg`/`Effect` and `Data` types are fully erased here: a bridge is
stored monomorphically in the registry, and `mount` builds + mounts the
sub-app, returning a disposer. Authors construct bridges with the typed
{@link decoratorBridge} helper, which captures concrete types in a closure.

```typescript
export interface DecoratorBridge {
  /** The id used by the contributing markdown transformer. */
  type: string
  /** Mount the sub-view for a node's (deserialized) data; returns a disposer. */
  mount: (container: Element, data: unknown, api: DecoratorApi<unknown>) => () => void
}
```

### `LexicalForeignOptions`

```typescript
export interface LexicalForeignOptions<Emit = unknown> {
  /** Editor namespace (instance isolation; required for distinct editors). */
  namespace: string
  theme?: EditorThemeClasses
  /** Node classes registered in addition to the plugins' own nodes. */
  nodes?: ReadonlyArray<Klass<LexicalNode>>
  /** Plugins: their `nodes` are merged, `register`/`shortcuts` wired at mount. */
  plugins?: ReadonlyArray<LexicalPlugin<Emit>>
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
  /** Lexical node classes registered on the editor config. */
  nodes?: ReadonlyArray<Klass<LexicalNode>>
  /** Imperative registration (commands, listeners). Returns a disposer. */
  register?: (editor: LexicalEditor, ctx: PluginContext<Emit>) => () => void
  /** Keyboard shortcuts wired through a single KEY_DOWN command. */
  shortcuts?: readonly ShortcutSpec[]
  /** Decorator bridges this plugin owns. */
  decorators?: readonly DecoratorBridge[]
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
}
```

## Constants

### `PROGRAMMATIC_TAG`

Lexical update tag marking a programmatic write (seed / controlled setValue),
so the outbound change listener doesn't echo it back to the host.

```typescript
const PROGRAMMATIC_TAG
```

<!-- auto-api:end -->

## Related

- [`@llui/markdown-editor`](/api/markdown-editor) — the WYSIWYG editor built on this seam.
- [`@llui/dom`](/api/dom) — `foreign()`, the imperative-library mounting primitive this package builds on.
- [Lexical documentation](https://lexical.dev) — the underlying editor framework.
