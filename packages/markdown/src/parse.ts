// parseMarkdown — the batteries-included parser: CommonMark + GFM by default.
//
// This is the ONLY module that imports the GFM extensions. Consumers who never
// want GFM should import from `@llui/markdown/commonmark` (which binds
// `parseCommonMark` from `./parse-core.js` and never reaches this module), so
// micromark/mdast GFM stays out of their bundle.
//
// Returns a real nested mdast tree (with `position` data), NOT an HTML string —
// the renderer walks it to build live DOM.

import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Root } from 'mdast'
import type { MarkdownOptions } from './types.js'
import { parseCommonMark } from './parse-core.js'

/** Parse Markdown source into an mdast {@link Root}. GFM is on unless
 * `opts.gfm === false`. Extra `extensions`/`mdastExtensions` are appended. */
export function parseMarkdown(src: string, opts: MarkdownOptions = {}): Root {
  if (opts.gfm === false) return parseCommonMark(src, opts)
  return parseCommonMark(src, {
    ...opts,
    extensions: [gfm(), ...(opts.extensions ?? [])],
    mdastExtensions: [gfmFromMarkdown(), ...(opts.mdastExtensions ?? [])],
  })
}
