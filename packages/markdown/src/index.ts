// @llui/markdown — reactive Markdown rendering for LLui.
//
// Parse Markdown to a real mdast AST, render it through LLui's authoring helpers
// as live reactive DOM (never an HTML string), with per-node-type custom renderers,
// safe-by-default URL/HTML handling, and content-hash-keyed top-level blocks so
// streaming / growing documents reuse unchanged blocks' DOM.

import { createMarkdown } from './render.js'
import { parseMarkdown } from './parse.js'

/** Reactive Markdown view (CommonMark + GFM). Composes like `text()` — returns a
 * `Mountable`. For a GFM-free build, import from `@llui/markdown/commonmark`. */
export const markdown = createMarkdown(parseMarkdown)

export { renderMarkdown, createMarkdown, type ParseFn } from './render.js'
export { parseMarkdown } from './parse.js'
export { defaultRenderers, mergeRenderers } from './renderers/index.js'
export { sanitizeUrl, resolveUrl } from './security.js'
export { makeContext, collectDefinitions } from './context.js'
export { toKeyedBlocks, blockSource, type KeyedBlock } from './keying.js'
export { resolveOptions } from './options.js'
export { incrementalParse, type ParseCache, type IncrementalResult } from './incremental.js'

export type {
  MarkdownOptions,
  ResolvedOptions,
  Renderers,
  NodeRenderer,
  RenderContext,
  TransformLink,
} from './types.js'
