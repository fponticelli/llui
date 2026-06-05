// parseMarkdown — thin wrapper over mdast-util-from-markdown (micromark) that
// wires GFM by default and threads user-supplied syntax/mdast extensions.
//
// Returns a real nested mdast tree (with `position` data), NOT an HTML string —
// the renderer walks it to build live DOM.

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Root } from 'mdast'
import type { Options as FromMarkdownOptions } from 'mdast-util-from-markdown'
import type { MarkdownOptions } from './types.js'

/** Parse Markdown source into an mdast {@link Root}. GFM is on unless
 * `opts.gfm === false`. Extra `extensions`/`mdastExtensions` are appended. */
export function parseMarkdown(src: string, opts: MarkdownOptions = {}): Root {
  const useGfm = opts.gfm ?? true

  const extensions: NonNullable<FromMarkdownOptions['extensions']> = []
  const mdastExtensions: NonNullable<FromMarkdownOptions['mdastExtensions']> = []

  if (useGfm) {
    extensions.push(gfm())
    mdastExtensions.push(gfmFromMarkdown())
  }
  if (opts.extensions) extensions.push(...opts.extensions)
  if (opts.mdastExtensions) mdastExtensions.push(...opts.mdastExtensions)

  return fromMarkdown(src, { extensions, mdastExtensions })
}
