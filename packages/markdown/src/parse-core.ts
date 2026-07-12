// parseCommonMark — CommonMark-only parser over mdast-util-from-markdown.
//
// This module NEVER imports the GFM extensions, so the `@llui/markdown/commonmark`
// entry (which binds it) keeps micromark/mdast GFM out of a consumer's bundle.
// User-supplied syntax/mdast extensions are still threaded through.
//
// Returns a real nested mdast tree (with `position` data), NOT an HTML string.

import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root } from 'mdast'
import type { Options as FromMarkdownOptions } from 'mdast-util-from-markdown'
import type { MarkdownOptions } from './types.js'

/** Parse Markdown source into an mdast {@link Root} using CommonMark only. The
 * `gfm` option is ignored here (there is no GFM on this path); pass
 * `extensions`/`mdastExtensions` for custom syntax. */
export function parseCommonMark(src: string, opts: MarkdownOptions = {}): Root {
  const extensions: NonNullable<FromMarkdownOptions['extensions']> = opts.extensions
    ? [...opts.extensions]
    : []
  const mdastExtensions: NonNullable<FromMarkdownOptions['mdastExtensions']> = opts.mdastExtensions
    ? [...opts.mdastExtensions]
    : []
  return fromMarkdown(src, { extensions, mdastExtensions })
}
