// @llui/markdown/commonmark — the GFM-free entry point.
//
// Identical surface to `@llui/markdown`, but `markdown`/`renderMarkdown`/
// `parseMarkdown` bind the CommonMark-only parser (`./parse-core.js`). Nothing in
// this module's import graph reaches `./parse.js`, so micromark/mdast GFM is never
// pulled into a consumer's bundle. Use this when you don't need tables, task
// lists, strikethrough, autolinks or footnotes and want the smaller bundle.

import { createMarkdown } from './render.js'
import { parseCommonMark } from './parse-core.js'

/** Reactive Markdown view (CommonMark only — no GFM). Composes like `text()` —
 * returns a `Mountable`. */
export const markdown = createMarkdown(parseCommonMark)

/** CommonMark-only parser (no GFM). Exported as `parseMarkdown` for parity with
 * the default entry. */
export { parseCommonMark as parseMarkdown } from './parse-core.js'

export { renderMarkdown, createMarkdown, type ParseFn } from './render.js'
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
