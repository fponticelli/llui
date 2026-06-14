// resolveOptions — apply defaults to user MarkdownOptions.

import type { MarkdownOptions, ResolvedOptions } from './types.js'
import { mergeRenderers } from './renderers/index.js'

const DEFAULT_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

export function resolveOptions(opts: MarkdownOptions = {}): ResolvedOptions {
  return {
    gfm: opts.gfm ?? true,
    renderers: mergeRenderers(opts.renderers),
    extensions: opts.extensions,
    mdastExtensions: opts.mdastExtensions,
    sanitizeHtml: opts.sanitizeHtml,
    allowedProtocols: opts.allowedProtocols ?? DEFAULT_PROTOCOLS,
    transformLink: opts.transformLink,
    class: opts.class ?? 'markdown-body',
    keyOf: opts.keyOf,
  }
}
