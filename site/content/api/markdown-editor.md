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

### `$createWikiLinkNode()`

Build a wikilink node. `target`/`alias` are sanitized to values the `[[…]]`
syntax can express (see {@link sanitizeWikiLinkTarget}); a target with nothing
usable left falls back to the literal text `Page` rather than yielding an
invisible token.

```typescript
function $createWikiLinkNode(target: string, alias: string | null = null): WikiLinkNode
```

### `$getFrontmatter()`

The document's frontmatter body, or `null` when it has none.

```typescript
function $getFrontmatter(): string | null
```

### `$insertCallout()`

Insert a fresh callout at the current selection; returns the created node.

```typescript
function $insertCallout(kind: CalloutKind = 'note', textValue = 'New callout'): LLuiDecoratorNode
```

### `$insertHorizontalRule()`

Insert a horizontal rule at the current selection.

```typescript
function $insertHorizontalRule(): void
```

### `$insertMarkdownAtSelection()`

Parse `markdown` with `transformers` and insert the produced nodes at the
current range selection. The document is parsed into a detached scratch
container (so the live root is never cleared) and the selection captured
before the import — which moves the caret into the scratch node — is restored
before the nodes are spliced in. Returns `true` only when nodes were actually
inserted; `false` (a no-op) when there is no range selection to insert into or
the markdown parsed to nothing — letting the caller fall back to the default
paste behaviour instead of silently swallowing the event.

```typescript
function $insertMarkdownAtSelection(markdown: string, transformers: Array<Transformer>): boolean
```

### `$isWikiLinkNode()`

```typescript
function $isWikiLinkNode(node: LexicalNode | null | undefined): node is WikiLinkNode
```

### `$setFrontmatter()`

Set (or, with `null`, remove) the document's frontmatter. The block is always
kept as the FIRST child of the root — it is only frontmatter there, and the
exporter relies on that position (see the transformer's `export`).

```typescript
function $setFrontmatter(source: string | null): void
```

### `blockAtPoint()`

The block whose vertical band contains `clientY`, or `null` when the pointer
is in no block's band.
TWO passes, and the order matters. A block's OWN rect always wins outright;
only a point in no block at all falls through to the widened search, where
the NEAREST band within `tolerance` wins (ties biased upward, matching how a
reader attributes a gap to the block above it).
A single widened pass with first-match-wins — which this was — is wrong
wherever two rects touch or nearly touch, and touching rects are the common
case, not the exotic one: list items, table rows, consecutive lines, and any
margin-collapsed heading. With `tolerance = 6` and adjacent rects [0,20] and
[20,40], every y in [20,26] resolved to the FIRST block, so the block below
lost the top 6px of its own body — the grip targeted, grabbed and dragged the
wrong block. Generally, for an inter-block gap `g < tolerance`, block N stole
the first `tolerance - g` px of block N+1.

```typescript
function blockAtPoint(
  blocks: readonly BlockRect[],
  clientY: number,
  tolerance: number = HOVER_TOLERANCE,
): BlockRect | null
```

### `blockDragPlugin()`

Reorder top-level blocks by dragging a hover gutter grip, or from the keyboard
(focus the grip, Enter/Space to grab, ↑/↓ to move, Enter/Space to drop, Escape
to cancel). Every reorder is one Lexical node move, hence one undo step.

```typescript
function blockDragPlugin(options: BlockDragOptions = {}): MarkdownPlugin
```

### `blockUnderlineFormat()`

Swallow the underline text-format command. `registerRichText` wires Cmd+U to
FORMAT_TEXT 'underline', but the GFM markdown dialect this editor serializes
has no underline representation, so an applied underline would be silently
stripped on save. Intercepting at CRITICAL priority (ahead of rich-text) keeps
the WYSIWYG surface and the serialized dialect in lock-step: underline can be
neither applied nor lost. Returns a disposer.

```typescript
function blockUnderlineFormat(editor: LexicalEditor): () => void
```

### `buildTransformers()`

Collect every plugin's transformers (de-duplicated by reference) and order
them. The result is passed to `$convertTo/FromMarkdownString` and
`registerMarkdownShortcuts`.

```typescript
function buildTransformers(plugins: readonly MarkdownPlugin[]): Transformer[]
```

### `calloutPlugin()`

```typescript
function calloutPlugin(opts: CalloutPluginOptions = {}): MarkdownPlugin
```

### `codeLanguagePlugin()`

```typescript
function codeLanguagePlugin(opts: CodeLanguagePluginOptions = {}): MarkdownPlugin
```

### `computeFormatState()`

Read the full format surface at the current selection (opens a read ctx).

```typescript
function computeFormatState(
  editor: LexicalEditor,
  history: Pick<SelectionContext, 'canUndo' | 'canRedo'>,
): FormatState
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

### `contextMenuPlugin()`

```typescript
function contextMenuPlugin(): MarkdownPlugin
```

### `corePlugin()`

```typescript
function corePlugin(_opts: CorePluginOptions = {}): MarkdownPlugin
```

### `countWords()`

Count whitespace-delimited words (shared by init and the format handler).

```typescript
function countWords(text: string): number
```

### `definePluginUI()`

Author a plugin UI module with full `State`/`Msg`/`Effect` types, erased for
storage. The casts are confined to this boundary (the host only knows
`unknown`), exactly like the decorator bridge.

```typescript
function definePluginUI<S, M, E = never>(spec: PluginUISpec<S, M, E>): PluginUI
```

### `emojiPlugin()`

```typescript
function emojiPlugin(opts: EmojiPluginOptions = {}): MarkdownPlugin
```

### `findDropTarget()`

The slot `clientY` points at, expressed relative to a neighbouring block.
The document has `n + 1` slots for `n` blocks; the slot index is the count of
blocks whose vertical midpoint is above the pointer. Two of those slots are
where `sourceKey` already sits — dropping there is a no-op, so both return
`null` and the caller shows no indicator and commits nothing. That check is
what stops a 1px twitch from producing a spurious undo entry.

```typescript
function findDropTarget(
  blocks: readonly BlockRect[],
  clientY: number,
  sourceKey: NodeKey,
): DropTarget | null
```

### `floatingToolbarPlugin()`

```typescript
function floatingToolbarPlugin(): MarkdownPlugin
```

### `formatWikiLink()`

Serialize a wikilink back to markdown. Inverse of {@link parseWikiLinkInner}
for every link built through this module's constructors — see
{@link sanitizeWikiLinkTarget} for why that qualifier is load-bearing.

```typescript
function formatWikiLink(link: WikiLink): string
```

### `frontmatterPlugin()`

```typescript
function frontmatterPlugin(opts: FrontmatterPluginOptions = {}): MarkdownPlugin
```

### `hrPlugin()`

```typescript
function hrPlugin(): MarkdownPlugin
```

### `imagePlugin()`

```typescript
function imagePlugin(opts: ImagePluginOptions = {}): MarkdownPlugin
```

### `indicatorRect()`

Where to draw the indicator line for a resolved {@link DropTarget}: on the
target's top edge for `before`, its bottom edge for `after`.

```typescript
function indicatorRect(blocks: readonly BlockRect[], target: DropTarget): IndicatorRect | null
```

### `init()`

```typescript
function init(opts: InitOptions): [EditorState, EditorEffect[]]
```

### `linkDialog()`

Render the link dialog. Hidden (portal, nothing inline) until `dialog.open`.

```typescript
function linkDialog(opts: LinkDialogOptions): Mountable
```

### `linkPlugin()`

```typescript
function linkPlugin(opts: LinkPluginOptions = {}): MarkdownPlugin
```

### `markdownEditor()`

Build the markdown editor component. Embed it with `mountApp(el, markdownEditor(...))`
or compose it inside a larger component.

```typescript
function markdownEditor(
  config: EditorConfig = {},
): SignalComponentDef<EditorState, EditorMsg, EditorEffect>
```

### `mathPlugin()`

```typescript
function mathPlugin(opts: MathPluginOptions = {}): MarkdownPlugin
```

### `mentionPlugin()`

```typescript
function mentionPlugin(opts: MentionPluginOptions = {}): MarkdownPlugin
```

### `mergeTheme()`

Merge a consumer theme over the default. `text` is merged per-key so a
consumer overriding (say) `strikethrough` keeps the other default entries.
Always returns a FRESH theme (never the shared `defaultTheme` singleton):
Lexical caches resolved class arrays by MUTATING the `text` object it is
handed (`text.__lexicalClassNameCache`). Handing it a fresh copy keeps the
exported singleton clean, and stripping any inherited cache prevents a stale
entry from a previously-used theme object shadowing an overridden class.

```typescript
function mergeTheme(theme?: EditorThemeClasses): EditorThemeClasses
```

### `mermaidPlugin()`

```typescript
function mermaidPlugin(opts: MermaidPluginOptions = {}): MarkdownPlugin
```

### `normalizeCodeInfo()`

Canonicalize a fence info string.
CommonMark's info string is the remainder of the opening-fence line with the
surrounding whitespace stripped; a blank one means "no language". Two
characters are removed rather than preserved, because keeping them would emit
markdown that no longer re-imports to the same block:

- a backtick — illegal in a backtick-fenced info string (it would terminate
  or corrupt the fence);
- a newline — it would end the fence line entirely.
  Everything else survives verbatim, including spaces (`'lance table'`) and
  punctuation (`'c++'`, `'objective-c'`).

```typescript
function normalizeCodeInfo(raw: string | null | undefined): string | null
```

### `orderTransformers()`

Stable-sort transformers into the order Lexical expects.

```typescript
function orderTransformers(transformers: readonly Transformer[]): Transformer[]
```

### `parseWikiLinkInner()`

Parse the content BETWEEN the brackets. Returns `null` when the content is not
a valid wikilink body.
Deliberate choices, each load-bearing for exact round-tripping:

- split on the FIRST `|` only, so `[[a|b|c]]` has alias `b|c` and re-exports
  byte-identically;
- an EMPTY alias (`[[a|]]`) normalizes to no alias — the alternative
  (keeping `alias: ''`) would render a zero-width, unclickable node;
- NO trimming. `[[ a ]]` keeps its spaces, because trimming would make
  import→export lossy. Presentation trimming is the host's call in
  `onNavigate`/`resolve`, not the document's.

```typescript
function parseWikiLinkInner(inner: string): WikiLink | null
```

### `registerMarkdownPaste()`

Register the markdown-on-paste handler on `editor`. Returns a disposer.
Plain-text pastes are converted as Markdown. Pastes that also carry
`text/html` are ignored so Lexical's richer HTML import handles them.

```typescript
function registerMarkdownPaste(editor: LexicalEditor, transformers: Array<Transformer>): () => void
```

### `sanitizeWikiLinkAlias()`

Sanitize an alias. Returns `null` when nothing usable survives.

```typescript
function sanitizeWikiLinkAlias(raw: string | null): string | null
```

### `sanitizeWikiLinkTarget()`

Sanitize a target. Returns `null` when nothing usable survives.

```typescript
function sanitizeWikiLinkTarget(raw: string): string | null
```

### `serializeFrontmatter()`

Render the fences back around an opaque body. An empty (or blank-only) body
collapses to the canonical two-line form so the result stays idempotent.

```typescript
function serializeFrontmatter(source: string): string
```

### `setTransformerPrecedence()`

Declare that `transformer` must be consulted before same-rank peers with a
higher value. Call at module scope, beside the transformer's definition.

```typescript
function setTransformerPrecedence(transformer: Transformer, value: number): void
```

### `singleBlockPlugin()`

```typescript
function singleBlockPlugin(opts: SingleBlockPluginOptions = {}): MarkdownPlugin
```

### `slashPlugin()`

```typescript
function slashPlugin(): MarkdownPlugin
```

### `splitFrontmatter()`

Split a leading frontmatter block off a markdown string: `[body, rest]`, or
`null` when the document has none (no line-0 fence, or no closing fence).
Exported because a consumer often needs the metadata BEFORE building an
editor — the same predicate the importer uses, so the two never disagree.

```typescript
function splitFrontmatter(markdown: string): [source: string, rest: string] | null
```

### `tablePlugin()`

```typescript
function tablePlugin(): MarkdownPlugin
```

### `toolbar()`

A ready-made grouped toolbar. Items not surfaced to `'toolbar'` are dropped.

```typescript
function toolbar(opts: ToolbarOptions): Mountable
```

### `update()`

```typescript
function update(state: EditorState, msg: EditorMsg): [EditorState, EditorEffect[]]
```

### `wikilinkPlugin()`

```typescript
function wikilinkPlugin(opts: WikiLinkPluginOptions = {}): MarkdownPlugin
```

## Types

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

### `CalloutKind`

```typescript
export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'
```

### `CodeLanguageEffect`

Write `language` (null clears it) onto the code block with node key `key`.

```typescript
export type CodeLanguageEffect = { type: 'apply'; key: string; language: string | null }
```

### `CodeLanguageMsg`

```typescript
export type CodeLanguageMsg =
  | { type: 'show'; key: string; x: number; y: number; language: string | null }
  | { type: 'hide' }
  | { type: 'edit' }
  | { type: 'input'; language: string }
  | { type: 'commit' }
  | { type: 'cancel' }
```

### `CollabFactory`

Builds the collab binding from the editor-supplied hooks.

```typescript
export type CollabFactory = (hooks: CollabHooks) => CollabBinding
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

### `InlineFormat`

An inline text-format surfaced as a toolbar command item.

```typescript
export type InlineFormat = 'bold' | 'italic' | 'strikethrough' | 'code'
```

### `ItemSurface`

Which surfaces a command item appears in (default: all).

```typescript
export type ItemSurface = 'toolbar' | 'floating' | 'slash' | 'context'
```

### `OverlayKind`

Which floating surface is currently open.

```typescript
export type OverlayKind = 'none' | 'floating' | 'slash' | 'context' | 'link'
```

### `Place`

Which side of the target block the source lands on.

```typescript
export type Place = 'before' | 'after'
```

### `SerializedWikiLinkNode`

```typescript
export type SerializedWikiLinkNode = Spread<
  { target: string; alias: string | null },
  SerializedTextNode
>
```

## Interfaces

### `BlockDragOptions`

```typescript
export interface BlockDragOptions {
  /** Gutter grip inset, in px left of the block's left edge. Default 28. */
  gutterOffset?: number
}
```

### `BlockRect`

The measured viewport geometry of one top-level block. Pure data — the unit
of everything below, so all placement logic is testable without a DOM.

```typescript
export interface BlockRect {
  key: NodeKey
  top: number
  bottom: number
  left: number
  width: number
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

### `CodeLanguagePluginOptions`

```typescript
export interface CodeLanguagePluginOptions {
  /** Suggestions offered in the language input's `<datalist>`. Purely advisory —
   * ANY info string may be typed, including multi-token ones. */
  languages?: readonly string[]
  /** Placeholder shown when a block has no language (default `'plain text'`). */
  placeholder?: string
  /** Accessible label for the language input (default `'Code block language'`). */
  label?: string
}
```

### `CodeLanguageState`

The language badge's state. JSON-serializable, like every LLui state slice.

```typescript
export interface CodeLanguageState {
  /** Whether the badge is shown. */
  open: boolean
  /** Viewport x of the anchor (the code block's right edge). */
  x: number
  /** Viewport y of the anchor (the code block's top edge). */
  y: number
  /** Node key of the anchored code block (`''` when none). */
  key: string
  /** The input's current value (the block's info string, or the in-flight edit). */
  language: string
  /** The info string as last read from the node — the baseline `cancel` restores
   * and `commit` diffs against, so a no-op commit never touches the document. */
  committed: string
  /** Whether the input has focus; a refresh must not overwrite what's being typed. */
  editing: boolean
  /** A `hide` that arrived mid-edit, applied when the edit ends. */
  pendingHide: boolean
}
```

### `CollabBinding`

Disposer-returning binding the collab layer installs on the live editor.
`@llui/lexical-collab`'s `YjsCollab` and `@llui/lexical-loro`'s `LoroCollab`
both satisfy this structurally, so `@llui/markdown-editor` needs neither a Yjs
nor a Loro dependency of its own.

```typescript
export interface CollabBinding {
  register: (editor: LexicalEditor) => () => void
  /**
   * A CRDT-aware undo owner, if the binding provides one SEPARATELY from
   * `register`. When present it is handed to `lexicalForeign({ externalUndo })`,
   * which forces the built-in `@lexical/history` stack off so the two can never
   * both be live — this is what gives collab mode real, peer-scoped undo.
   *
   * Optional because not every binding splits undo out this way: `yjsCollab`
   * installs its own undo commands INSIDE `register`, so it leaves this unset and
   * still owns undo. A binding that sets neither would leave the editor with no
   * undo at all — see `@llui/lexical-loro`, which sets this.
   */
  externalUndo?: (editor: LexicalEditor) => () => void
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

### `CorePluginOptions`

```typescript
export interface CorePluginOptions {
  /** Reserved for future core options. */
  readonly _?: never
}
```

### `DropTarget`

A resolved drop slot: "put the dragged block `place` this `key`".

```typescript
export interface DropTarget {
  key: NodeKey
  place: Place
}
```

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

### `EmojiPluginOptions`

```typescript
export interface EmojiPluginOptions {
  /** Extra/override shortcode → emoji entries (merged over the defaults). */
  emoji?: Readonly<Record<string, string>>
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

### `FrontmatterData`

The frontmatter node's payload: the block body, verbatim, with no fences.

```typescript
export interface FrontmatterData {
  /** The raw text between the opening and closing `---`. Never interpreted. */
  source: string
}
```

### `FrontmatterPluginOptions`

```typescript
export interface FrontmatterPluginOptions {
  /** Render the raw block to a preview (e.g. parse with your own YAML library
   * and draw a table). Return a DOM `Node` (mounted directly) or a **trusted**
   * HTML string — see `renderedPreview`'s security note. */
  render?: PreviewRender
  /** Accessible label for the raw-source editor (default `'Frontmatter'`). */
  label?: string
  /** Placeholder shown for an empty block (default `'key: value'`). */
  placeholder?: string
  /** Show the raw source editor. Set false for a `render`-only presentation
   * (the block still round-trips; it just isn't editable in place). Default true. */
  editable?: boolean
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

### `IndicatorRect`

Viewport position of the drop-indicator line.

```typescript
export interface IndicatorRect {
  x: number
  y: number
  width: number
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

### `LinkPluginOptions`

```typescript
export interface LinkPluginOptions {
  /** Default URL pre-filled when there's no existing link (default ''). */
  defaultUrl?: string
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

### `PluginViewArgs`

Args for a plugin's `view` — its reactive state slice + a scoped dispatcher.

```typescript
export interface PluginViewArgs<S, M> {
  state: Signal<S>
  send: (msg: M) => void
  editor: () => LexicalEditor | null
}
```

### `SingleBlockPluginOptions`

```typescript
export interface SingleBlockPluginOptions {
  /** Inline formats surfaced as toolbar items.
   * Default `['bold', 'italic', 'strikethrough', 'code']`. NOTE: this limits the
   * toolbar buttons only — markdown syntax (`*x*`) and Ctrl/⌘ shortcuts still
   * apply every inline format, and all inline markdown round-trips regardless. */
  formats?: readonly InlineFormat[]
  /** Allow soft line breaks within the single paragraph. When `false` (default)
   * Enter is inert and pasted/seeded line breaks collapse to spaces — a strict
   * single-line field. When `true`, Enter inserts a `\n` and merged lines are
   * joined with a line break instead of a space. A new paragraph is never made. */
  allowLineBreaks?: boolean
  /** Register `LinkNode` + the markdown link transformer so inline links
   * round-trip. Default `false`. Compose with `linkPlugin()` for the toolbar
   * button + insert dialog. */
  link?: boolean
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

### `WikiLink`

A parsed wikilink. `alias` is `null` when the target is shown verbatim.

```typescript
export interface WikiLink {
  target: string
  alias: string | null
}
```

### `WikiLinkPluginOptions`

```typescript
export interface WikiLinkPluginOptions {
  /**
   * Called when the user activates a wikilink. This is the host's resolution
   * seam: `@llui/markdown-editor` knows nothing about what a target names.
   *
   * The notification travels the same route as every other plugin event —
   * `ctx.emit` → the editor's update loop → this plugin's reducer → an effect —
   * rather than a raw DOM event, so an activation is an ordinary TEA message
   * that shows up in devtools, replay and agent traces.
   */
  onNavigate?: (link: WikiLink) => void
  /** Text used as the target when the insert command runs with no selection. */
  placeholderTarget?: string
  /**
   * Document-search seam: as the user types `[[query`, resolve matching
   * documents to offer as link targets, with an optional content preview shown in
   * the panel's reference pane. Sync or async (async is debounced; a stale
   * response for a superseded query is dropped). When omitted, the panel never
   * opens and `[[target]]` still works by typing the closing `]]`.
   */
  search?: (query: string) => readonly DocCandidate[] | Promise<readonly DocCandidate[]>
}
```

## Classes

### `WikiLinkNode`

An atomic inline wikilink. Extends `TextNode` so the caret, selection and
text formats behave exactly as they do for prose, while `token` mode keeps it
indivisible: the user can delete it or move past it, but never edit its
interior into a state where the visible alias disagrees with `__target`.

```typescript
class WikiLinkNode extends TextNode {
  __target: string
  __alias: string | null
  getType(): string
  clone(node: WikiLinkNode): WikiLinkNode
  constructor(target: string, alias: string | null, text?: string, key?: NodeKey)
  importJSON(serializedNode: SerializedWikiLinkNode): WikiLinkNode
  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedWikiLinkNode>): this
  exportJSON(): SerializedWikiLinkNode
  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement
  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean
  getTarget(): string
  setTarget(target: string): this
  getAlias(): string | null
  setAlias(alias: string | null): this
  getLink(): WikiLink
  canInsertTextBefore(): boolean
  canInsertTextAfter(): boolean
}
```

## Constants

### `BLOCK_DRAG_Z`

Stacking levels for this plugin's two surfaces — deliberately below the
shared `OVERLAY_Z` scale (60+) so document chrome never covers a menu.

```typescript
const BLOCK_DRAG_Z
```

### `CODE_LANGUAGE_PLUGIN`

This plugin's registry name (the `plugin` message envelope's `name`).

```typescript
const CODE_LANGUAGE_PLUGIN
```

### `FRONTMATTER_BRIDGE_TYPE`

The decorator bridge id for the frontmatter block.

```typescript
const FRONTMATTER_BRIDGE_TYPE
```

### `GFM_NODES`

Node classes required to render the GFM superset.

```typescript
const GFM_NODES: ReadonlyArray<Klass<LexicalNode>>
```

### `GFM_TRANSFORMERS`

Markdown ↔ node transformers for the GFM superset.

```typescript
const GFM_TRANSFORMERS: readonly Transformer[]
```

### `HIGHLIGHT_TRANSFORMER`

The `==highlight==` transformer. NOT part of the default GFM set: `==..==` is
not GFM, so exporting it produces non-standard markdown other renderers won't
understand. Offered as an opt-in a consumer can add to a plugin's transformers.

```typescript
const HIGHLIGHT_TRANSFORMER: Transformer
```

### `STRIKETHROUGH_CLASS`

```typescript
const STRIKETHROUGH_CLASS
```

<!-- auto-api:end -->

## Related

- [`@llui/lexical`](/api/lexical) — the low-level Lexical ↔ signal-runtime binding this editor is built on.
- [`@llui/dom`](/api/dom) — the runtime; `markdownEditor()` is a standard LLui component.
- [Examples on GitHub](https://github.com/fponticelli/llui/tree/main/examples/markdown-editor) — full editor wired with every plugin.
