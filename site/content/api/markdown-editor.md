---
title: '@llui/markdown-editor'
description: 'WYSIWYG Markdown editor for LLui — hides Markdown behind a rich, pluggable editing widget built on Lexical.'
---

# @llui/markdown-editor

A WYSIWYG Markdown editor you drop into an LLui app as a single component. The user edits rich text; the editor's state holds the Markdown. It is built on [`@llui/lexical`](/api/lexical) and ships a transformer registry (GFM, callouts, …), a toolbar surface, and a set of opt-in plugins for the features beyond plain prose — links, images, tables, math, mentions, emoji, slash commands, and more.

```bash
pnpm add @llui/markdown-editor @llui/lexical @llui/dom lexical
```

`@llui/lexical` and `lexical` come along as the editing engine.

## Quick start

`markdownEditor()` returns an ordinary LLui component — mount it with `mountApp`, or place it inside a larger view. Its state exposes the live Markdown (`value`), word/char counts, and dirty/read-only flags.

```ts
import { mountApp } from '@llui/dom'
import { markdownEditor, corePlugin, linkPlugin } from '@llui/markdown-editor'

const app = mountApp(
  document.getElementById('editor')!,
  markdownEditor({
    toolbar: true,
    plugins: [corePlugin(), linkPlugin()],
    defaultValue: '# Hello\n\nStart typing…',
    changeDebounceMs: 150,
  }),
)

// The editor's state IS the source of truth for the Markdown:
app.subscribe((s) => console.log(s.value, `${s.wordCount} words`))
```

## Plugins

Features are plugins you compose into the `plugins` list — only what you pass is wired in, so unused features tree-shake away. `corePlugin()` covers headings, lists, blockquotes, inline marks, and code. The rest are opt-in:

`linkPlugin`, `imagePlugin`, `tablePlugin`, `hrPlugin`, `mathPlugin`, `mermaidPlugin`, `mentionPlugin`, `emojiPlugin`, `calloutPlugin`, `slashPlugin`, `contextMenuPlugin`, `floatingToolbarPlugin`.

Author your own with `definePluginUI` and the `MarkdownPlugin` / `CommandItem` contract — the same shape the built-ins use.

## Transformers

The Markdown ⇄ editor mapping is a transformer registry. `GFM_TRANSFORMERS` / `GFM_NODES` add GitHub-Flavored Markdown (tables, task lists, strikethrough); `buildTransformers` / `orderTransformers` let a plugin contribute its own (the callout plugin, for instance, registers a `> [!NOTE]` transformer).

## Toolbar

`markdownEditor({ toolbar: true })` renders the default toolbar. For a custom chrome, drive it yourself with `connectToolbar` (a Signal-handle part bag you spread onto your own elements) or the prebuilt `toolbar()` surface, plus `computeFormatState` to derive button active-states from the current selection.

## API

<!-- auto-api:start -->

## Functions

### `markdownEditor()`

Build the markdown editor component. Embed it with `mountApp(el, markdownEditor(...))`
or compose it inside a larger component.

```typescript
function markdownEditor(
  config: EditorConfig = {},
): SignalComponentDef<EditorState, EditorMsg, EditorEffect>
```

### `init()`

```typescript
function init(opts: InitOptions): [EditorState, EditorEffect[]]
```

### `update()`

```typescript
function update(state: EditorState, msg: EditorMsg): [EditorState, EditorEffect[]]
```

### `countWords()`

Count whitespace-delimited words (shared by init and the format handler).

```typescript
function countWords(text: string): number
```

### `computeFormatState()`

Read the full format surface at the current selection (opens a read ctx).

```typescript
function computeFormatState(
  editor: LexicalEditor,
  history: Pick<SelectionContext, 'canUndo' | 'canRedo'>,
): FormatState
```

### `definePluginUI()`

Author a plugin UI module with full `State`/`Msg`/`Effect` types, erased for
storage. The casts are confined to this boundary (the host only knows
`unknown`), exactly like the decorator bridge.

```typescript
function definePluginUI<S, M, E = never>(spec: PluginUISpec<S, M, E>): PluginUI
```

### `corePlugin()`

```typescript
function corePlugin(_opts: CorePluginOptions = {}): MarkdownPlugin
```

### `linkPlugin()`

```typescript
function linkPlugin(opts: LinkPluginOptions = {}): MarkdownPlugin
```

### `$insertCallout()`

Insert a fresh callout at the current selection; returns the created node.

```typescript
function $insertCallout(kind: CalloutKind = 'note', textValue = 'New callout'): LLuiDecoratorNode
```

### `calloutPlugin()`

```typescript
function calloutPlugin(opts: CalloutPluginOptions = {}): MarkdownPlugin
```

### `$insertHorizontalRule()`

Insert a horizontal rule at the current selection.

```typescript
function $insertHorizontalRule(): void
```

### `hrPlugin()`

```typescript
function hrPlugin(): MarkdownPlugin
```

### `slashPlugin()`

```typescript
function slashPlugin(): MarkdownPlugin
```

### `contextMenuPlugin()`

```typescript
function contextMenuPlugin(): MarkdownPlugin
```

### `floatingToolbarPlugin()`

```typescript
function floatingToolbarPlugin(): MarkdownPlugin
```

### `mathPlugin()`

```typescript
function mathPlugin(opts: MathPluginOptions = {}): MarkdownPlugin
```

### `mermaidPlugin()`

```typescript
function mermaidPlugin(opts: MermaidPluginOptions = {}): MarkdownPlugin
```

### `mentionPlugin()`

```typescript
function mentionPlugin(opts: MentionPluginOptions = {}): MarkdownPlugin
```

### `emojiPlugin()`

```typescript
function emojiPlugin(opts: EmojiPluginOptions = {}): MarkdownPlugin
```

### `imagePlugin()`

```typescript
function imagePlugin(opts: ImagePluginOptions = {}): MarkdownPlugin
```

### `tablePlugin()`

```typescript
function tablePlugin(): MarkdownPlugin
```

### `orderTransformers()`

Stable-sort transformers into the order Lexical expects.

```typescript
function orderTransformers(transformers: readonly Transformer[]): Transformer[]
```

### `buildTransformers()`

Collect every plugin's transformers (de-duplicated by reference) and order
them. The result is passed to `$convertTo/FromMarkdownString` and
`registerMarkdownShortcuts`.

```typescript
function buildTransformers(plugins: readonly MarkdownPlugin[]): Transformer[]
```

### `connectToolbar()`

Build reactive toolbar parts from the format signal. Spread `item(id)` onto a
`<button>`; `aria-pressed` / `data-active` / `disabled` track the format.

```typescript
function connectToolbar(
  format: Signal<FormatState>,
  send: Send<EditorMsg>,
  items: readonly CommandItem[],
): ToolbarParts
```

### `toolbar()`

A ready-made grouped toolbar. Items not surfaced to `'toolbar'` are dropped.

```typescript
function toolbar(opts: ToolbarOptions): Mountable
```

### `linkDialog()`

Render the link dialog. Hidden (portal, nothing inline) until `dialog.open`.

```typescript
function linkDialog(opts: LinkDialogOptions): Mountable
```

## Types

### `CollabFactory`

Builds the collab binding from the editor-supplied hooks.

```typescript
export type CollabFactory = (hooks: CollabHooks) => CollabBinding
```

### `BlockType`

The block kind at the selection — base rich-text kinds plus list/code,
resolved by the markdown layer.

```typescript
export type BlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'code'
  | 'bullet'
  | 'number'
  | 'check'
  | 'other'
```

### `OverlayKind`

Which floating surface is currently open.

```typescript
export type OverlayKind = 'none' | 'floating' | 'slash' | 'context' | 'link'
```

### `EditorMsg`

```typescript
export type EditorMsg =
  | { type: 'markdownChanged'; value: string }
  | { type: 'formatChanged'; format: FormatState; wordCount: number; charCount: number }
  | { type: 'runCommand'; id: string }
  | { type: 'setValue'; value: string }
  | { type: 'openOverlay'; overlay: OverlayKind; x?: number; y?: number }
  | { type: 'closeOverlay' }
  | { type: 'slashQuery'; query: string }
  | { type: 'setReadOnly'; readonly: boolean }
  | { type: 'collabStatus'; connected: boolean }
  | { type: 'collabSync'; synced: boolean }
  | { type: 'collabPeers'; peers: number }
  /** Route a message to a plugin's UI reducer (see {@link PluginUI}). */
  | { type: 'plugin'; name: string; msg: unknown }
```

### `EditorOutMsg`

The subset of messages a plugin may emit through its `PluginContext` (e.g. a
`register` listener routing an editor event into its own plugin UI).

```typescript
export type EditorOutMsg = Extract<
  EditorMsg,
  { type: 'openOverlay' | 'closeOverlay' | 'slashQuery' | 'plugin' }
>
```

### `EditorEffect`

```typescript
export type EditorEffect =
  | { type: 'execCommand'; id: string }
  | { type: 'applyValue'; value: string }
  | { type: 'emitChange'; value: string }
  | { type: 'emitFormat'; format: FormatState }
  /** An effect produced by a plugin's UI reducer (see {@link PluginUI}). */
  | { type: 'pluginEffect'; name: string; effect: unknown }
```

### `ItemSurface`

Which surfaces a command item appears in (default: all).

```typescript
export type ItemSurface = 'toolbar' | 'floating' | 'slash' | 'context'
```

### `HostEmit`

The host message type a plugin effect may emit (the editor's full Msg).

```typescript
export type HostEmit = (msg: unknown) => void
```

### `CalloutKind`

```typescript
export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'
```

## Interfaces

### `EditorConfig`

```typescript
export interface EditorConfig {
  /** Plugins composing the feature set; order defines transformer precedence.
   * Defaults to `[corePlugin(), linkPlugin()]` so the minimal editor has GFM + links. */
  plugins?: readonly MarkdownPlugin[]
  /** Initial markdown (uncontrolled seed). */
  defaultValue?: string
  /** Controlled: the consumer owns this signal; the editor follows it. */
  value?: Signal<string>
  /** Debounced markdown-emission window (ms). Default 300. */
  changeDebounceMs?: number
  placeholder?: string
  readonly?: boolean
  /** Lexical theme class map. */
  theme?: EditorThemeClasses
  /** Editor namespace (instance isolation). */
  namespace?: string
  /** Outbound markdown (after debounce). */
  onChange?: (markdown: string) => void
  /** Outbound format surface (for chrome built outside this package). */
  onFormatChange?: (format: FormatState) => void
  /** Receives the live Lexical editor at mount (imperative access, collab hooks). */
  onReady?: (editor: LexicalEditor) => void
  /** Render the built-in toolbar above the editor. Default false (minimal). */
  toolbar?: boolean
  /** Convert plain-text Markdown to rich content on paste. Default true.
   * Pastes that carry `text/html` are always left to Lexical's HTML import,
   * regardless of this flag. Set false to paste Markdown as literal text. */
  pasteMarkdown?: boolean
  /** Enable collaborative editing. The editor hands you a markdown `seed` and
   * status sinks; return a binding (build it with `yjsCollab` from
   * `@llui/lexical-collab`, wiring your own provider). Mutually exclusive with
   * `value` — the shared CRDT document, not a markdown signal, owns the content.
   * `defaultValue` becomes the seed the bootstrapping peer writes. */
  collab?: CollabFactory
}
```

### `CollabBinding`

Disposer-returning binding the collab layer installs on the live editor.
`@llui/lexical-collab`'s `YjsCollab` satisfies this structurally, so
`@llui/markdown-editor` needs no Yjs dependency of its own.

```typescript
export interface CollabBinding {
  register: (editor: LexicalEditor) => () => void
}
```

### `CollabHooks`

Hooks the editor injects into the {@link CollabFactory}: a markdown `seed`
(run once by the bootstrapping peer to fill an empty shared doc from
`defaultValue`) plus status sinks the editor mirrors into `state.collab`.
Spread straight into `yjsCollab({ id, provider, user, ...hooks })`.

```typescript
export interface CollabHooks {
  seed: (editor: LexicalEditor) => void
  onStatus: (connected: boolean) => void
  onSync: (synced: boolean) => void
  onPeers: (count: number) => void
}
```

### `EditorParts`

Hooks the chrome layer (toolbar/menus) uses to compose around the editor.

```typescript
export interface EditorParts {
  /** The merged, surface-filtered command items. */
  items: readonly CommandItem[]
  /** Reactive format signal for `connect`-style toolbars. */
  format: Signal<FormatState>
}
```

### `FormatState`

The toolbar-facing format surface at the current selection (all primitives).

```typescript
export interface FormatState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  code: boolean
  link: boolean
  blockType: BlockType
  alignment: Alignment
  canUndo: boolean
  canRedo: boolean
}
```

### `CollabStatus`

Live collaborative-session status (mirror of the CRDT provider state).
`enabled` is false unless the editor was created with a `collab` factory.

```typescript
export interface CollabStatus {
  enabled: boolean
  connected: boolean
  synced: boolean
  /** Remote peers currently present (excludes this client). */
  peers: number
}
```

### `EditorState`

```typescript
export interface EditorState {
  /** Last serialized markdown (mirror of the live document). */
  value: string
  format: FormatState
  wordCount: number
  charCount: number
  ui: {
    activeOverlay: OverlayKind
    slashQuery: string
    menu: { x: number; y: number }
  }
  /** Per-plugin UI state slices, keyed by plugin name (see {@link PluginUI}). */
  plugins: Record<string, unknown>
  dirty: boolean
  readonly: boolean
  /** Collaborative-session status (always present; inert unless `collab` set). */
  collab: CollabStatus
}
```

### `InitOptions`

```typescript
export interface InitOptions {
  value: string
  readonly: boolean
  /** Whether a collaborative session is wired (drives `collab.enabled`). */
  collab?: boolean
}
```

### `CommandContext`

Handed to a command item's `run` so it can talk back to the host (e.g. open
the link dialog) instead of only mutating the editor.

```typescript
export interface CommandContext {
  send: (msg: EditorMsg) => void
}
```

### `CommandItem`

A user-invokable editor command surfaced to the chrome. Its reactive
active/disabled state is read from {@link FormatState}; `run` mutates the
live editor.

```typescript
export interface CommandItem {
  /** Stable id (also the `runCommand` payload). */
  id: string
  label: string
  /** Optional icon hint (class / svg id); rendering is the consumer's CSS. */
  icon?: string
  /** Grouping key for menu sectioning. */
  group?: string
  /** Keyword aliases for slash/command-palette filtering. */
  keywords?: readonly string[]
  isActive?: (format: FormatState) => boolean
  isDisabled?: (format: FormatState) => boolean
  run: (editor: LexicalEditor, ctx: CommandContext) => void
  surfaces?: readonly ItemSurface[]
}
```

### `MarkdownPlugin`

A markdown editor plugin: engine wiring + transformers + UI items + an
optional stateful UI extension (its own state slice, reducer, view, effects).

```typescript
export interface MarkdownPlugin extends LexicalPlugin<EditorOutMsg> {
  /** Markdown ↔ node transformers contributed to the registry. */
  transformers?: readonly Transformer[]
  /** Command items surfaced to the toolbar / slash / context menus. */
  items?: readonly CommandItem[]
  /** A stateful UI extension keyed by this plugin's `name` (see {@link definePluginUI}). */
  ui?: PluginUI
  /** Receive the merged command items from all plugins (e.g. a slash menu lists
   * every plugin's items). Called once at editor construction. */
  onItems?: (items: readonly CommandItem[]) => void
}
```

### `PluginEffectContext`

Context for a plugin's `onEffect` — reach the live editor and dispatch back.

```typescript
export interface PluginEffectContext<M> {
  /** The live Lexical editor (null before mount). */
  editor: () => LexicalEditor | null
  /** Dispatch a message back into this plugin. */
  send: (msg: M) => void
  /** Dispatch a host editor message (e.g. `{type:'runCommand', id}`). */
  emit: (msg: unknown) => void
}
```

### `PluginViewArgs`

Args for a plugin's `view` — its reactive state slice + a scoped dispatcher.

```typescript
export interface PluginViewArgs<S, M> {
  state: Signal<S>
  send: (msg: M) => void
  editor: () => LexicalEditor | null
}
```

### `PluginUISpec`

A typed plugin UI module (authored via {@link definePluginUI}).

```typescript
export interface PluginUISpec<S, M, E = never> {
  /** Initial slice state (JSON-serializable). */
  init: () => S
  /** Pure reducer over the slice; may return effects. */
  update?: (state: S, msg: M) => S | [S, E[]]
  /** View contribution (overlays/panels), rendered by the host. */
  view?: (args: PluginViewArgs<S, M>) => Renderable
  /** Effect handler with live-editor access + host dispatch. */
  onEffect?: (effect: E, ctx: PluginEffectContext<M>) => void
}
```

### `PluginUI`

The type-erased form stored on a plugin and consumed by the host.

```typescript
export interface PluginUI {
  init: () => unknown
  update?: (state: unknown, msg: unknown) => unknown | [unknown, unknown[]]
  view?: (args: PluginViewArgs<unknown, unknown>) => Renderable
  onEffect?: (effect: unknown, ctx: PluginEffectContext<unknown>) => void
}
```

### `CorePluginOptions`

```typescript
export interface CorePluginOptions {
  /** Reserved for future core options. */
  readonly _?: never
}
```

### `LinkPluginOptions`

```typescript
export interface LinkPluginOptions {
  /** Default URL pre-filled when there's no existing link (default ''). */
  defaultUrl?: string
}
```

### `CalloutData`

```typescript
export interface CalloutData {
  kind: CalloutKind
  text: string
}
```

### `CalloutPluginOptions`

```typescript
export interface CalloutPluginOptions {
  /** Default kind for the toolbar/slash insert action. */
  defaultKind?: CalloutKind
}
```

### `MathPluginOptions`

```typescript
export interface MathPluginOptions {
  /** Typeset TeX to an HTML string (e.g. via KaTeX). When omitted, the raw TeX is
   * shown in a styled box. */
  /** Render the TeX source to a preview. Return a DOM `Node` (mounted
   * directly, no sanitization) or a **trusted HTML string** (injected as-is
   * — sanitize it yourself, e.g. via DOMPurify, since it carries document
   * content). See `renderedPreview`. */
  render?: PreviewRender
}
```

### `MermaidPluginOptions`

```typescript
export interface MermaidPluginOptions {
  /** Render the diagram source to an HTML string (e.g. mermaid). When omitted,
   * the raw source is shown in a styled box. */
  /** Render the mermaid source to a preview. Return a DOM `Node` (mounted
   * directly, no sanitization) or a **trusted HTML string** (injected as-is
   * — sanitize it yourself, e.g. via DOMPurify, since it carries document
   * content). See `renderedPreview`. */
  render?: PreviewRender
}
```

### `Mention`

```typescript
export interface Mention {
  id: string
  label: string
}
```

### `MentionPluginOptions`

```typescript
export interface MentionPluginOptions {
  /** Resolve candidates for a query (default: a small sample list). */
  source?: (query: string) => readonly Mention[]
}
```

### `EmojiPluginOptions`

```typescript
export interface EmojiPluginOptions {
  /** Extra/override shortcode → emoji entries (merged over the defaults). */
  emoji?: Readonly<Record<string, string>>
}
```

### `ImagePluginOptions`

```typescript
export interface ImagePluginOptions {
  /** Upload a chosen file and resolve to its URL. When omitted, the file picker
   * is hidden and only URL entry is offered. */
  upload?: (file: File) => Promise<string>
}
```

### `ToolbarItemParts`

```typescript
export interface ToolbarItemParts {
  type: 'button'
  'data-scope': 'md-toolbar'
  'data-part': 'item'
  'data-id': string
  'aria-label': string
  title: string
  'aria-pressed': Signal<'true' | 'false'>
  'aria-disabled': Signal<'true' | undefined>
  disabled: Signal<boolean>
  'data-active': Signal<'' | undefined>
  onClick: (e: MouseEvent) => void
}
```

### `ToolbarParts`

```typescript
export interface ToolbarParts {
  root: {
    role: 'toolbar'
    'aria-label': string
    'data-scope': 'md-toolbar'
    'data-part': 'root'
  }
  item: (id: string) => ToolbarItemParts
}
```

### `ToolbarOptions`

```typescript
export interface ToolbarOptions {
  format: Signal<FormatState>
  send: Send<EditorMsg>
  items: readonly CommandItem[]
  /** Explicit grouped layout of ids; defaults to grouping by `item.group`. */
  groups?: readonly (readonly string[])[]
  /** Glyph overrides (id → text/emoji). Merged over {@link DEFAULT_GLYPHS}. */
  glyphs?: Readonly<Record<string, string>>
  /** Render the `block` group as a `<select>` dropdown instead of buttons
   * (default true). */
  blockSelect?: boolean
  /** Collaborative-session status. When supplied AND `enabled`, the toolbar
   * appends a presence indicator (connection dot + live peer count). */
  collab?: Signal<CollabStatus>
  'aria-label'?: string
}
```

### `LinkDialogOptions`

```typescript
export interface LinkDialogOptions {
  /** The `{ open }` slice driving the modal. */
  dialog: Signal<DialogState>
  /** The URL input value. */
  url: Signal<string>
  /** Called as the user edits the URL. */
  onInput: (url: string) => void
  /** Called on Apply / Enter. */
  onSubmit: () => void
  /** Called when the dialog requests open/close (dismiss, close button). */
  onDialog: (msg: DialogMsg) => void
  /** Dialog instance id for ARIA wiring (default 'md-link-dialog'). */
  id?: string
}
```

## Constants

### `GFM_NODES`

Node classes required to render the GFM superset.

```typescript
const GFM_NODES: ReadonlyArray<Klass<LexicalNode>>
```

### `INLINE_TEXT_TRANSFORMERS`

Inline text-format transformers (no block nodes, no node registration). These
are the only transformers a single-block / inline-only editor needs; `LINK` is
kept separate since it requires `LinkNode` to be registered.

```typescript
const INLINE_TEXT_TRANSFORMERS: readonly Transformer[]
```

### `GFM_TRANSFORMERS`

Markdown ↔ node transformers for the GFM superset.

```typescript
const GFM_TRANSFORMERS: readonly Transformer[]
```

<!-- auto-api:end -->

## Related

- [`@llui/lexical`](/api/lexical) — the low-level Lexical ↔ signal-runtime binding this editor is built on.
- [`@llui/dom`](/api/dom) — the runtime; `markdownEditor()` is a standard LLui component.
- [Examples on GitHub](https://github.com/fponticelli/llui/tree/main/examples/markdown-editor) — full editor wired with every plugin.
