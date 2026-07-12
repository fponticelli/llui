/**
 * Shared DOM helpers used by interaction utilities.
 */

export type ElementSource<T extends Element = Element> = T | T[] | (() => T | T[] | null)

export function resolveElements<T extends Element>(source: ElementSource<T>): T[] {
  const resolved = typeof source === 'function' ? source() : source
  if (!resolved) return []
  return Array.isArray(resolved) ? resolved : [resolved]
}

export function containsOrEquals(container: Element, target: Node | null): boolean {
  if (!target) return false
  return container === target || container.contains(target)
}

export function isInAnyElement(target: Node | null, elements: Element[]): boolean {
  for (const el of elements) {
    if (containsOrEquals(el, target)) return true
  }
  return false
}

/**
 * The innermost, non-retargeted target of an event.
 *
 * At a shadow-DOM boundary the browser RETARGETS `event.target` to the shadow
 * host for any listener outside the shadow tree — so a document-level capture
 * listener sees the host element, not the element actually interacted with
 * inside the shadow root. `event.composedPath()[0]` is the real deepest target
 * (the path is composed across shadow boundaries and is populated while the
 * event is dispatching, which is when capture-phase handlers run). Fall back to
 * `event.target` when `composedPath` is unavailable or empty (non-DOM env / an
 * already-dispatched event). Essential for outside-interaction detection to work
 * when a component is mounted inside a shadow root (isolate mode) — otherwise
 * every in-shadow interaction reads as the host and is misclassified.
 */
export function composedTarget(event: Event): Node | null {
  const path = event.composedPath?.()
  if (path && path.length > 0) return path[0] as Node
  return (event.target as Node | null) ?? null
}
