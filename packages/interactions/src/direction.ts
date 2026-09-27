/** Text reading direction. The single shared RTL vocabulary for the package. */
export type TextDirection = 'ltr' | 'rtl'

/**
 * Resolve the text direction for an element by walking up the DOM tree.
 * Returns 'rtl' or 'ltr' (default).
 *
 * The walk crosses SHADOW boundaries: `Element.closest()` stops at the
 * nearest shadow root and cannot see a `dir` set on an ancestor of the host,
 * so an element inside a shadow tree whose host (or the host's own
 * ancestors) declares `dir` would otherwise silently read as `ltr`. Continuing
 * from `root.host` after `getRootNode()` returns a `ShadowRoot` walks out to
 * the light-DOM ancestor and keeps going, arbitrarily many shadow levels
 * deep. The final fallback reads `dir` off the element's OWN document
 * (`ownerDocument`), never the global `document` — the global binding names a
 * DIFFERENT document inside an iframe or any other multi-document context.
 */
export function resolveDir(el: Element): TextDirection {
  let current: Element | null = el
  while (current !== null) {
    if (current.hasAttribute('dir')) return current.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
    if (current.parentElement !== null) {
      current = current.parentElement
      continue
    }
    const root = current.getRootNode()
    current = root instanceof ShadowRoot ? root.host : null
  }
  return el.ownerDocument.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
}

/**
 * Map a horizontal arrow key to its logical direction, accounting for RTL.
 * This is the SINGLE SOURCE OF TRUTH every component routes horizontal arrow
 * interpretation through. Under rtl, ArrowLeft and ArrowRight swap meaning;
 * vertical arrows (Up/Down), Home/End, PageUp/PageDown and every non-arrow key
 * pass through unchanged.
 *
 * The second argument is the direction source:
 *  - an explicit `'ltr' | 'rtl'` — used directly (the authoritative form when a
 *    component stores `dir` in its own State and passes it in);
 *  - an `Element` — direction is resolved by walking up the DOM (`dir="rtl"`
 *    ancestor or `document.documentElement.dir`);
 *  - `null` — treated as `'ltr'` (no-op).
 */
export function flipArrow(key: string, source: Element | null | TextDirection): string {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return key
  const dir = resolveTextDirection(source)
  if (dir !== 'rtl') return key
  return key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'
}

/**
 * Normalize any accepted direction source to a concrete `TextDirection`.
 * An explicit `'ltr' | 'rtl'` wins; an `Element` is resolved from the DOM;
 * `null` / `undefined` default to `'ltr'`.
 */
export function resolveTextDirection(
  source: Element | null | undefined | TextDirection,
): TextDirection {
  if (source === 'ltr' || source === 'rtl') return source
  if (source == null) return 'ltr'
  return resolveDir(source)
}
