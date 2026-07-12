// resolveOptions — apply defaults to user MarkdownOptions.

import type { MarkdownOptions, ResolvedOptions } from './types.js'
import { mergeRenderers } from './renderers/index.js'
import { defaultAllowedProtocols } from './security.js'

export function resolveOptions(opts: MarkdownOptions = {}): ResolvedOptions {
  return {
    gfm: opts.gfm ?? true,
    renderers: mergeRenderers(opts.renderers),
    extensions: opts.extensions,
    mdastExtensions: opts.mdastExtensions,
    sealSafeExtensions: opts.sealSafeExtensions ?? false,
    sanitizeHtml: opts.sanitizeHtml,
    allowedProtocols: opts.allowedProtocols ?? [...defaultAllowedProtocols],
    transformLink: opts.transformLink,
    class: opts.class ?? 'markdown-body',
    keyOf: opts.keyOf,
  }
}
