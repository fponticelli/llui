// URL safety — neutralize dangerous link/image schemes (javascript:, data:, …).
//
// Strategy mirrors micromark's own `sanitizeUri`: a scheme only "counts" when its
// colon precedes any `/`, `?`, or `#` (otherwise the colon is part of a path,
// query, or fragment and the URL is relative — always safe). A recognized scheme
// must be on the allowlist; a scheme containing any non-scheme character (control
// chars, whitespace — e.g. `java\nscript:`) is treated as unsafe.

import type { Link, Image, LinkReference, ImageReference } from 'mdast'
import type { ResolvedOptions } from './types.js'

/** Returns the URL unchanged if its scheme is allowed (or it is relative),
 * otherwise `null`. */
export function sanitizeUrl(url: string, allowedProtocols: readonly string[]): string | null {
  const value = String(url)
  const colon = value.indexOf(':')
  if (colon < 0) return value // no scheme → relative/anchor/query, safe

  const slash = value.indexOf('/')
  const question = value.indexOf('?')
  const hash = value.indexOf('#')
  // colon after a path/query/fragment delimiter ⇒ not a scheme ⇒ relative.
  if (
    (slash > -1 && colon > slash) ||
    (question > -1 && colon > question) ||
    (hash > -1 && colon > hash)
  ) {
    return value
  }

  const scheme = value.slice(0, colon).toLowerCase()
  if (/[^a-z0-9+.-]/.test(scheme)) return null // mangled scheme (e.g. embedded \n) ⇒ unsafe
  return allowedProtocols.includes(scheme) ? value : null
}

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
