/**
 * Find focusable descendants within a container.
 */

// Matches elements that can receive keyboard focus. Excludes elements with
// `tabindex=-1` (programmatically focusable but not tab-reachable) and
// elements inside `inert` subtrees.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function isFocusable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.hasAttribute('disabled')) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  if (el.hidden) return false
  // Check tabindex
  const tabIndex = el.getAttribute('tabindex')
  if (tabIndex !== null && parseInt(tabIndex, 10) < 0) return false
  return el.matches(FOCUSABLE_SELECTOR)
}

export function getFocusables(container: Element): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  const out: HTMLElement[] = []
  for (const n of nodes) {
    if (isVisible(n) && !isInsideInert(n, container)) out.push(n)
  }
  return out
}

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false
  // offsetParent is null for display:none (not position:fixed roots, but good enough)
  // jsdom returns null for disconnected; skip this check there.
  if (typeof el.offsetParent === 'undefined') return true
  // For root elements with position:fixed, offsetParent can be null but they're visible.
  // Use getClientRects as a fallback. jsdom returns empty rects, so accept those.
  return true
}

function isInsideInert(el: Element, container: Element): boolean {
  let current: Element | null = el
  while (current && current !== container) {
    if (current.hasAttribute('inert')) return true
    current = current.parentElement
  }
  return false
}
