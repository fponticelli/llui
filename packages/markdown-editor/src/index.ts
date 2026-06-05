// `@llui/markdown-editor` — WYSIWYG Markdown editor for LLui, built on Lexical.

export { type EditorConfig, type EditorParts, markdownEditor } from './editor.js'

export {
  type BlockType,
  type FormatState,
  type OverlayKind,
  type EditorState,
  type EditorMsg,
  type EditorOutMsg,
  type EditorEffect,
  type InitOptions,
  EMPTY_FORMAT,
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
export { type LinkPluginOptions, linkPlugin } from './plugins/link.js'
export {
  type CalloutKind,
  type CalloutData,
  type CalloutPluginOptions,
  calloutPlugin,
  $insertCallout,
} from './plugins/callout.js'
export { hrPlugin, $insertHorizontalRule } from './plugins/hr.js'
export { slashPlugin } from './plugins/slash.js'
export { contextMenuPlugin } from './plugins/context-menu.js'
export { floatingToolbarPlugin } from './plugins/floating-toolbar.js'
export { type EmojiPluginOptions, DEFAULT_EMOJI, emojiPlugin } from './plugins/emoji.js'
export { type ImagePluginOptions, imagePlugin } from './plugins/image.js'

export { GFM_NODES, GFM_TRANSFORMERS } from './transformers/gfm.js'
export { buildTransformers, orderTransformers } from './transformers/registry.js'

export { computeFormatState } from './format.js'

export {
  type ToolbarItemParts,
  type ToolbarParts,
  type ToolbarOptions,
  DEFAULT_GLYPHS,
  connectToolbar,
  toolbar,
} from './surfaces/toolbar.js'

export { type LinkDialogOptions, linkDialog } from './surfaces/link-dialog.js'
