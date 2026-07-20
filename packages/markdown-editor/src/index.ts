// `@llui/markdown-editor` — WYSIWYG Markdown editor for LLui, built on Lexical.

export {
  type EditorConfig,
  type EditorParts,
  type CollabBinding,
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
export { tablePlugin } from './plugins/table.js'
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
