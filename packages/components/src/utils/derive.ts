/**
 * Derive a value ONCE per update instead of recomputing it per item.
 *
 * `connect()` runs once, but the `state.map(...)` body of every per-item prop
 * runs on EVERY update for EVERY item. An `Array.includes` in one of those is a
 * full scan per item — O(N²) per update over the list, the only such cost in
 * the package (#124: a 200-item select scanned a 200-long array 800 times per
 * update; `menu`'s `isDisabled` re-walked the whole item tree per item).
 *
 * The memo is keyed on ARGUMENT IDENTITY, which is sound because `update()` is
 * pure and returns a NEW array/object whenever the contents change — the same
 * signal the reconciler itself gates on. An in-place mutation is invisible
 * here exactly as it is invisible there.
 *
 * Hold the derivation in the `connect()` closure, never at module scope: one
 * cell per component instance, so two mounted lists cannot evict each other.
 */

/**
 * Wrap `compute` so that repeating a call with the same arguments returns the
 * previous result. One cell — the first item of an update pays for the
 * derivation and the rest read it, so the cost is per UPDATE, not per item and
 * not per render.
 */
export function deriveOnce<A extends readonly unknown[], R>(
  compute: (...args: A) => R,
): (...args: A) => R {
  let cell: { args: A; result: R } | null = null
  return (...args: A): R => {
    if (cell !== null && sameArgs(cell.args, args)) return cell.result
    const result = compute(...args)
    cell = { args, result }
    return result
  }
}

function sameArgs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

const EMPTY_SET: ReadonlySet<never> = new Set<never>()
const EMPTY_MAP: ReadonlyMap<never, never> = new Map<never, never>()

/**
 * A membership lookup over a state array: `set(s.value).has(item)` in place of
 * `s.value.includes(item)`. An absent collection reads as empty.
 */
export function membershipSet<T>(): (values: readonly T[] | null | undefined) => ReadonlySet<T> {
  const derive = deriveOnce(
    (values: readonly T[] | null | undefined): ReadonlySet<T> =>
      values == null ? EMPTY_SET : new Set(values),
  )
  return derive
}

/**
 * A position lookup over a state array: `positions(s.items).get(item)` in place
 * of `s.items.indexOf(item)`. First occurrence wins, matching `indexOf`.
 */
export function indexMap<T>(): (values: readonly T[] | null | undefined) => ReadonlyMap<T, number> {
  return deriveOnce((values: readonly T[] | null | undefined): ReadonlyMap<T, number> => {
    if (values == null) return EMPTY_MAP
    const positions = new Map<T, number>()
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!
      if (!positions.has(value)) positions.set(value, i)
    }
    return positions
  })
}
