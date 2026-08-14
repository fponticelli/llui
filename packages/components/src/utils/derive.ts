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
 * Wrap a ONE-ARGUMENT `compute` so that repeating a call with the same argument
 * returns the previous result. One cell — the first item of an update pays for
 * the derivation and the rest read it, so the cost is per UPDATE, not per item
 * and not per render.
 *
 * This is the shape that runs per ROW per BINDING per update, so it takes a
 * FIXED parameter and compares with one `Object.is`. The variadic `deriveOnceN`
 * below materialises a fresh arguments array on every call — one per row per
 * binding per update — which is pure overhead on the hit path: over a pass of
 * N items x 4 bindings, 0.00056 -> 0.00041 ms at N=20, 0.00467 -> 0.00337 at
 * N=200 and 0.05680 -> 0.03823 at N=2000 (~25-33%). Reach for `deriveOnceN`
 * only where the derivation genuinely takes several inputs.
 *
 * NO RUNTIME ARITY GUARD, deliberately. Calling the returned function with a
 * second argument silently ignores it — `g(1,'x')` and `g(1,'y')` both return
 * the `g(1)` result from one computation — so a JS consumer, or a TS consumer
 * who casts, can get a wrong answer with no error. That is accepted because
 * the only ways to observe arity at runtime are an `arguments` object (absent
 * in an arrow) or a rest parameter, and a rest parameter re-materialises the
 * per-row-per-binding array whose removal is this function's entire reason to
 * exist — paying the 25-33% back on the hottest path in the package, on every
 * hit, to catch a call TypeScript already rejects (TS2554). Do NOT "fix" this
 * by widening the signature. If a derivation needs more than one input, that
 * is what `deriveOnceN` is for.
 */
export function deriveOnce<A, R>(compute: (arg: A) => R): (arg: A) => R {
  // One cell per RECOMPUTATION (once per update), never per call: a fixed
  // parameter means no arguments array is materialised on the hit path.
  let cell: { arg: A; result: R } | null = null
  return (arg: A): R => {
    if (cell !== null && Object.is(cell.arg, arg)) return cell.result
    const result = compute(arg)
    cell = { arg, result }
    return result
  }
}

/**
 * `deriveOnce` for a derivation with several inputs (the roving tab stop reads
 * three or four). Memoized on ARGUMENT IDENTITY, position by position.
 */
export function deriveOnceN<A extends readonly unknown[], R>(
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
 *
 * An EMPTY array shares `EMPTY_SET` rather than allocating: most of the ~16
 * call sites are a `disabled`/`disabledItems` list that is empty in the common
 * case, and an empty `Set` is the one input where the memo would otherwise pay
 * an allocation to answer `false` to everything.
 */
export function membershipSet<T>(): (values: readonly T[] | null | undefined) => ReadonlySet<T> {
  const derive = deriveOnce(
    (values: readonly T[] | null | undefined): ReadonlySet<T> =>
      values == null || values.length === 0 ? EMPTY_SET : new Set(values),
  )
  return derive
}

/**
 * A position lookup over a state array: `positions(s.items).get(item)` in place
 * of `s.items.indexOf(item)`. First occurrence wins, matching `indexOf`.
 */
export function indexMap<T>(): (values: readonly T[] | null | undefined) => ReadonlyMap<T, number> {
  return deriveOnce((values: readonly T[] | null | undefined): ReadonlyMap<T, number> => {
    if (values == null || values.length === 0) return EMPTY_MAP
    const positions = new Map<T, number>()
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!
      if (!positions.has(value)) positions.set(value, i)
    }
    return positions
  })
}
