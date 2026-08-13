// `@llui/markdown-editor` — WYSIWYG Markdown editor for LLui, built on Lexical.

export {
  type EditorConfig,
  type EditorParts,
  type CollabBinding,
  type CollabBindingSlots,
  type CollabHooks,
  type CollabFactory,
  markdownEditor,
  blockUnderlineFormat,
} from './editor.js'

export {
  type BlockType,
  type FormatState,
  type OverlayKind,
  type CollabStatus,
  type EditorState,
  type EditorMsg,
  type EditorOutMsg,
  type EditorEffect,
  type InitOptions,
  EMPTY_FORMAT,
  COLLAB_OFF,
  init,
  update,
  countWords,
} from './state.js'

export {
  type ItemSurface,
  type CommandItem,
  type CommandContext,
  type MarkdownPlugin,
} from './plugins/types.js'

export {
  type PluginUI,
  type PluginUISpec,
  type PluginViewArgs,
  type PluginEffectContext,
  definePluginUI,
} from './plugins/ui.js'

export { type CorePluginOptions, corePlugin } from './plugins/core.js'
export {
  type InlineFormat,
  type SingleBlockPluginOptions,
  singleBlockPlugin,
} from './plugins/single-block.js'
export { type LinkPluginOptions, linkPlugin } from './plugins/link.js'
export {
  type CalloutKind,
  type CalloutData,
  type CalloutPluginOptions,
  calloutPlugin,
  $insertCallout,
} from './plugins/callout.js'
export { hrPlugin, $insertHorizontalRule } from './plugins/hr.js'
export {
  type FrontmatterData,
  type FrontmatterPluginOptions,
  FRONTMATTER_BRIDGE_TYPE,
  FRONTMATTER_TRANSFORMER,
  frontmatterPlugin,
  serializeFrontmatter,
  splitFrontmatter,
  $getFrontmatter,
  $setFrontmatter,
} from './plugins/frontmatter.js'
export { slashPlugin } from './plugins/slash.js'
export { contextMenuPlugin } from './plugins/context-menu.js'
export { floatingToolbarPlugin } from './plugins/floating-toolbar.js'
export { type MathPluginOptions, mathPlugin } from './plugins/math.js'
export { type MermaidPluginOptions, mermaidPlugin } from './plugins/mermaid.js'
export { type Mention, type MentionPluginOptions, mentionPlugin } from './plugins/mention.js'
export { type EmojiPluginOptions, DEFAULT_EMOJI, emojiPlugin } from './plugins/emoji.js'
export { type ImagePluginOptions, imagePlugin } from './plugins/image.js'
export {
  type ImageData,
  IMAGE_BRIDGE_TYPE,
  IMAGE_TRANSFORMER,
  isImageData,
  // The CommonMark image line ⇄ data pair `IMAGE_TRANSFORMER` is built from.
  // Exported for hosts that resolve/create image references themselves (a paste
  // handler writing an attachment path) and need the editor's exact spelling —
  // `formatImageLine` is the true inverse of `parseImageLine`.
  parseImageLine,
  formatImageLine,
} from './transformers/image.js'
// NOT re-exported: `tablePlugin` — it lives at `@llui/markdown-editor/plugins/table`.
// It is the only module in the package that imports `@lexical/table`, and a barrel
// re-export makes that package's peer mandatory for every consumer, tables or not.
// Its own entry point is what lets the peer be optional (#75).
export {
  type CodeLanguagePluginOptions,
  type CodeLanguageState,
  type CodeLanguageMsg,
  type CodeLanguageEffect,
  CODE_LANGUAGE_PLUGIN,
  codeLanguagePlugin,
} from './plugins/code-language.js'
export {
  type WikiLink,
  type WikiLinkPluginOptions,
  // Part of the `search` seam's public contract (`WikiLinkPluginOptions['search']`
  // resolves to `DocCandidate[]`), so a host implementing that seam can name it.
  type DocCandidate,
  type SerializedWikiLinkNode,
  WikiLinkNode,
  $createWikiLinkNode,
  $isWikiLinkNode,
  parseWikiLinkInner,
  formatWikiLink,
  // The representability guards that make `formatWikiLink` the true inverse of
  // `parseWikiLinkInner`; exported so a host resolving/creating targets can
  // apply the same normalization before it hands one to `$createWikiLinkNode`.
  sanitizeWikiLinkTarget,
  sanitizeWikiLinkAlias,
  wikilinkPlugin,
} from './plugins/wikilink.js'
export {
  type BlockDragOptions,
  type BlockRect,
  type DropTarget,
  type IndicatorRect,
  type Place,
  BLOCK_DRAG_Z,
  blockAtPoint,
  findDropTarget,
  indicatorRect,
  blockDragPlugin,
} from './plugins/block-drag.js'

export { $insertMarkdownAtSelection, registerMarkdownPaste } from './paste.js'

export { GFM_NODES, GFM_TRANSFORMERS, HIGHLIGHT_TRANSFORMER } from './transformers/gfm.js'
// The CommonMark-correct fenced-code transformer. Already part of
// `GFM_TRANSFORMERS`; exported for consumers assembling a transformer set by hand.
export { CODE_INFO_TRANSFORMER, normalizeCodeInfo } from './transformers/code.js'
// The CommonMark-correct list transformers — a marker change starts a new list
// (#129) and `[X]` ticks a box (#100). Already part of `GFM_TRANSFORMERS`; they
// require `MARKDOWN_LIST_NODES` (already part of `GFM_NODES`) to be registered,
// since two adjacent lists cannot survive a stock `ListNode`.
export {
  CHECK_LIST_TRANSFORMER,
  ORDERED_LIST_TRANSFORMER,
  UNORDERED_LIST_TRANSFORMER,
  isCheckedMarker,
} from './transformers/list.js'
export {
  MARKDOWN_LIST_NODES,
  MarkdownListNode,
  $isMarkdownListNode,
  asListMarker,
  type ListMarker,
  type AnyListNode,
} from './nodes/list.js'
// `setTransformerPrecedence` breaks ties between SAME-rank transformers, so a
// collision (e.g. wikilink vs upstream LINK, which both match at the same index)
// is resolved structurally instead of by the order a consumer lists plugins in.
export {
  buildTransformers,
  orderTransformers,
  setTransformerPrecedence,
} from './transformers/registry.js'

export { computeFormatState } from './format.js'

export { STRIKETHROUGH_CLASS, defaultTheme, mergeTheme } from './theme.js'

export {
  type ToolbarItemParts,
  type ToolbarParts,
  type ToolbarOptions,
  DEFAULT_GLYPHS,
  connectToolbar,
  toolbar,
} from './surfaces/toolbar.js'

export { type LinkDialogOptions, linkDialog } from './surfaces/link-dialog.js'
