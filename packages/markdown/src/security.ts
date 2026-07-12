// URL safety for markdown links/images.
//
// The scheme-allowlisting algorithm (`sanitizeUrl`) and the shared baseline
// allowlist (`defaultAllowedProtocols`) now live in `@llui/security` — the ONE
// canonical home so security-sensitive logic can't drift between packages. This
// module re-exports them (keeping `@llui/markdown`'s `sanitizeUrl` /
// `defaultAllowedProtocols` / `./security` public surface unchanged) and adds the
// markdown-specific `resolveUrl` that threads a link through `transformLink`.

import type { Link, Image, LinkReference, ImageReference } from 'mdast'
import type { ResolvedOptions } from './types.js'
import { sanitizeUrl, defaultAllowedProtocols } from '@llui/security'

export { sanitizeUrl, defaultAllowedProtocols }

/** Resolve a link/image URL through `transformLink` (if any) then sanitize it.
 * Returns the final URL, or `null` if the link/image should be dropped. */
export function resolveUrl(
  url: string,
  node: Link | Image | LinkReference | ImageReference,
  options: ResolvedOptions,
): string | null {
  let candidate = url
  if (options.transformLink) {
    const transformed = options.transformLink(url, node)
    if (transformed === null) return null
    candidate = transformed
  }
  return sanitizeUrl(candidate, options.allowedProtocols)
}
