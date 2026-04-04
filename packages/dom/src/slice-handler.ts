/**
 * Lens-style adapter that lifts a sub-component's `update` into a handler that
 * operates on a parent's full state and message type. Pairs with
 * `mergeHandlers` to compose sub-components into a parent component's reducer.
 *
 * - `get` / `set` isolate the sub-component's state slice within the parent state.
 * - `narrow` takes the parent message and returns the sub-message if this slice
 *   handles it, or `null` to pass through.
 * - `sub` is the sub-component's pure reducer (operates on its own state + msg).
 *
 * Example — embedding `dialog.update` into a parent reducer:
 *
 * ```ts
 * const update = mergeHandlers<State, Msg, Effect>(
 *   sliceHandler({
 *     get: (s) => s.confirm,
 *     set: (s, v) => ({ ...s, confirm: v }),
 *     narrow: (m) => m.type === 'confirm' ? m.msg : null,
 *     sub: dialog.update,
 *   }),
 *   appUpdate,
 * )
 * ```
 */
export function sliceHandler<S, M, E, SubS, SubM>(opts: {
  get: (state: S) => SubS
  set: (state: S, slice: SubS) => S
  narrow: (msg: M) => SubM | null
  sub: (slice: SubS, msg: SubM) => [SubS, E[]]
}): (state: S, msg: M) => [S, E[]] | null {
  return (state, msg) => {
    const subMsg = opts.narrow(msg)
    if (subMsg === null) return null
    const [nextSlice, effects] = opts.sub(opts.get(state), subMsg)
    return [opts.set(state, nextSlice), effects]
  }
}
