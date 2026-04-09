/**
 * Resolve the text direction for an element by walking up the DOM tree.
 * Returns 'rtl' or 'ltr' (default).
 */
export function resolveDir(el: Element): 'ltr' | 'rtl' {
  const ancestor = el.closest('[dir]')
  if (ancestor) return ancestor.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
  if (typeof document !== 'undefined' && document.documentElement.dir === 'rtl') return 'rtl'
  return 'ltr'
}

/**
 * Map an arrow key to its logical direction, accounting for RTL.
 * In RTL, ArrowLeft and ArrowRight swap; vertical arrows are unchanged.
 */
export function flipArrow(key: string, el: Element | null): string {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return key
  if (!el) return key
  const rtl = resolveDir(el) === 'rtl'
  if (!rtl) return key
  return key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'
}
