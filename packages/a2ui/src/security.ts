/**
 * Security primitives for rendering hostile, server/LLM-driven A2UI envelopes.
 *
 * Everything here treats its input as attacker-controlled: URL schemes, registry
 * keys, CSS values and pointer tokens all arrive from an untrusted server.
 *
 * NOTE: {@link sanitizeUrl} is a near-duplicate of `@llui/markdown`'s
 * `sanitizeUrl` (packages/markdown/src/security.ts). We keep a local copy rather
 * than take a package dependency on `@llui/markdown` for a ~15-line helper;
 * `allowedProtocols` is not a value export there either. FOLLOW-UP: extract a
 * shared `@llui/security` (or similar) util and have both packages consume it.
 */

/** URL schemes allowed for navigation/link actions (openUrl). */
export const LINK_PROTOCOLS: readonly string[] = ['http', 'https']

/** URL schemes allowed for media `src` (images/video/audio may inline via data:). */
export const MEDIA_PROTOCOLS: readonly string[] = ['http', 'https', 'data']

/** `Object.prototype.hasOwnProperty` guard usable on null-prototype records too. */
export function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * Returns the URL unchanged if its scheme is on `allowedProtocols` (or it is a
 * relative/anchor/query URL — always safe), otherwise `null`.
 *
 * Mirrors micromark's `sanitizeUri`: a scheme only "counts" when its colon
 * precedes any `/`, `?`, or `#`. Tab/CR/LF are stripped and leading control/space
 * chars ignored first, the way a browser does — so `java\tscript:` or a leading
 * control char cannot hide a dangerous scheme.
 */
export function sanitizeUrl(url: string, allowedProtocols: readonly string[]): string | null {
  const stripped = String(url).replace(/[\t\n\r]/g, '')
  let from = 0
  while (from < stripped.length && stripped.charCodeAt(from) <= 0x20) from++
  const value = stripped.slice(from)
  const colon = value.indexOf(':')
  if (colon < 0) return value // no scheme → relative/anchor/query, safe

  const slash = value.indexOf('/')
  const question = value.indexOf('?')
  const hash = value.indexOf('#')
  if (
    (slash > -1 && colon > slash) ||
    (question > -1 && colon > question) ||
    (hash > -1 && colon > hash)
  ) {
    return value
  }

  const scheme = value.slice(0, colon).toLowerCase()
  if (/[^a-z0-9+.-]/.test(scheme)) return null // mangled scheme (embedded control char) ⇒ unsafe
  return allowedProtocols.includes(scheme) ? value : null
}

/**
 * Resolve `url` against the current document and return its href only if it
 * navigates to `http:`/`https:`; otherwise `null`. Used by the `openUrl` action,
 * which must never open `javascript:`, `data:`, `file:`, … targets.
 */
export function safeHttpUrl(url: string): string | null {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined
    const u = new URL(url, base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/**
 * Sanitize a CSS value destined for interpolation into an inline `style` string.
 * Rejects values that could break out of the current declaration or inject new
 * ones (`;`, `{`, `}`) or escape any string/comment context (`<`, `>`, `\`, `"`,
 * `'`, `` ` ``, `@`, backslash). When the platform exposes `CSS.supports`, the
 * value must additionally be a value the browser accepts for `property`.
 * Returns the value if safe, else `null`.
 */
export function safeCssValue(property: string, value: string): string | null {
  if (/[;{}<>@\\"'`]/.test(value)) return null
  if (/url\s*\(/i.test(value)) return null // no external resource loads via theme
  const css = (globalThis as { CSS?: { supports(p: string, v: string): boolean } }).CSS
  if (css && typeof css.supports === 'function') {
    try {
      if (!css.supports(property, value)) return null
    } catch {
      return null
    }
  }
  return value
}
