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
