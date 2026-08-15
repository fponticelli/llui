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
  const tabindex = el.getAttribute('tabindex')
  if (tabindex !== null && parseInt(tabindex, 10) < 0) return false
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
  // In jsdom there is no layout engine: `offsetParent` is always `null` and
  // `getClientRects()` is always empty, so a real geometry test would wrongly
  // reject EVERY element. Detect that environment and skip the geometry check.
  // The heuristic: a browser lays out `document.body` (non-null offsetParent on
  // a child, or a non-empty rect); jsdom never does.
  if (isLayoutlessEnv(el)) return true
  // `display:none` (on the element or any ancestor) collapses `offsetParent` to
  // `null` — the cheap primary signal. `position:fixed`/`sticky` roots can also
  // have a `null` offsetParent while being perfectly visible, so fall back to
  // `getClientRects()`, which is non-empty for any laid-out box.
  if (el.offsetParent !== null) return true
  return el.getClientRects().length > 0
}

/**
 * True when the host has no layout engine (jsdom / SSR-ish DOM), where every
 * element reports a `null` offsetParent and zero client rects regardless of
 * visibility. Probed once against `document.body`, which a real browser always
 * lays out.
 */
function isLayoutlessEnv(el: HTMLElement): boolean {
  const body = el.ownerDocument?.body
  if (!body) return true
  // A real browser lays out `document.body` (a non-empty client rect spanning
  // the viewport). jsdom never does, so an empty rect list means "no layout".
  // (`body.offsetParent` is unreliable here — it is `null` in browsers too.)
  return body.getClientRects().length === 0
}

function isInsideInert(el: Element, container: Element): boolean {
  let current: Element | null = el
  while (current && current !== container) {
    if (current.hasAttribute('inert')) return true
    current = current.parentElement
  }
  return false
}
