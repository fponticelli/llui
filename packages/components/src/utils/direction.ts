/** Text reading direction. The single shared RTL vocabulary for the package. */
export type TextDirection = 'ltr' | 'rtl'

/**
 * Resolve the text direction for an element by walking up the DOM tree.
 * Returns 'rtl' or 'ltr' (default).
 */
export function resolveDir(el: Element): TextDirection {
  const ancestor = el.closest('[dir]')
  if (ancestor) return ancestor.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
  if (typeof document !== 'undefined' && document.documentElement.dir === 'rtl') return 'rtl'
  return 'ltr'
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
