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

export { type ItemSurface, type CommandItem, type MarkdownPlugin } from './plugins/types.js'

export { type CorePluginOptions, corePlugin } from './plugins/core.js'
export {
  type CalloutKind,
  type CalloutData,
  type CalloutPluginOptions,
  calloutPlugin,
  $insertCallout,
} from './plugins/callout.js'

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
