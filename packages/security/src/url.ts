// URL safety — neutralize dangerous link/image schemes (javascript:, data:, …).
//
// Strategy mirrors micromark's own `sanitizeUri`: a scheme only "counts" when its
// colon precedes any `/`, `?`, or `#` (otherwise the colon is part of a path,
// query, or fragment and the URL is relative — always safe). A recognized scheme
// must be on the allowlist; a scheme containing any non-scheme character (control
// chars, whitespace — e.g. `java\nscript:`) is treated as unsafe.
//
// Path-relative URLs (`/x`, `./x`, `#a`, `?q`) carry no scheme and inherit the
// document's origin, so they are always safe. A PROTOCOL-relative URL (`//host/x`)
// is different: it also has no colon-scheme, but it points at an arbitrary host
// under the page's effective protocol (http/https), so it is a live cross-origin
// request in disguise. It is therefore gated against the allowlist rather than
// waved through as "relative".
//
// This is the ONE canonical implementation shared by `@llui/markdown`,
// `@llui/markdown-editor`, and `@llui/a2ui`. Per-surface allow-lists (which
// schemes a given ingress accepts) are DATA passed in `allowedProtocols`, not a
// divergent copy of this algorithm.

/** The schemes permitted by default in links (and, via markdown, images).
 * Relative URLs (no scheme) are always allowed regardless of this list. This is
 * the shared baseline every consumer builds on instead of hand-rolling a
 * divergent allowlist. */
export const defaultAllowedProtocols: readonly string[] = ['http', 'https', 'mailto', 'tel']

/**
 * Returns the URL unchanged if its scheme is on `allowedProtocols` (or it is a
 * relative/anchor/query URL — always safe), otherwise `null`.
 *
 * Mirrors micromark's `sanitizeUri`: a scheme only "counts" when its colon
 * precedes any `/`, `?`, or `#`. Tab/CR/LF are stripped and leading control/space
 * chars ignored first, the way a browser does — so `java\tscript:` or a leading
 * control char cannot hide a dangerous scheme.
 *
 * `allowedProtocols` defaults to {@link defaultAllowedProtocols}.
 */
export function sanitizeUrl(
  url: string,
  allowedProtocols: readonly string[] = defaultAllowedProtocols,
): string | null {
  // Normalize the way a browser does before scheme resolution: tab/CR/LF
  // are stripped anywhere in a URL, and leading ASCII control/space chars
  // are ignored. Without this, `java\tscript:` or a leading control char
  // would hide a dangerous scheme from the checks below.
  const stripped = String(url).replace(/[\t\n\r]/g, '')
  let from = 0
  while (from < stripped.length && stripped.charCodeAt(from) <= 0x20) from++
  const value = stripped.slice(from)

  // Protocol-relative (`//host/path`): no colon-scheme, but NOT relative — it
  // resolves to an arbitrary host under the page's effective protocol. Its
  // scheme is whichever of http/https the document uses, so it is only safe
  // when BOTH are permitted; otherwise the effective protocol might be blocked.
  if (value.startsWith('//')) {
    return allowedProtocols.includes('http') && allowedProtocols.includes('https') ? value : null
  }

  const colon = value.indexOf(':')
  if (colon < 0) return value // no scheme → path-relative/anchor/query, safe

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
