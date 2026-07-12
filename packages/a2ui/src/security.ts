/**
 * Security primitives for rendering hostile, server/LLM-driven A2UI envelopes.
 *
 * Everything here treats its input as attacker-controlled: URL schemes, registry
 * keys, CSS values and pointer tokens all arrive from an untrusted server.
 *
 * The scheme-allowlisting algorithm (`sanitizeUrl`) is owned by `@llui/security`
 * — the single canonical copy shared with `@llui/markdown` / `@llui/markdown-editor`
 * so a fix can't drift. Re-exported here for the existing a2ui import sites. The
 * per-surface protocol SETS below are a2ui POLICY (data), not a divergent
 * algorithm.
 */

import { sanitizeUrl } from '@llui/security'

export { sanitizeUrl }

/** URL schemes allowed for navigation/link actions (openUrl). */
export const LINK_PROTOCOLS: readonly string[] = ['http', 'https']

/** URL schemes allowed for media `src` (images/video/audio may inline via data:). */
export const MEDIA_PROTOCOLS: readonly string[] = ['http', 'https', 'data']

/** `Object.prototype.hasOwnProperty` guard usable on null-prototype records too. */
export function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
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
