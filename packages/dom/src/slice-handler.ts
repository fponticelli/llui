/**
 * Lens-style adapter that lifts a sub-component's `update` into a handler that
 * operates on a parent's full state and message type. Pairs with
 * `mergeHandlers` to compose sub-components into a parent component's reducer.
 *
 * **Full form** — explicit lens for custom state paths or message shapes:
 *
 * ```ts
 * sliceHandler({
 *   get: (s) => s.confirm,
 *   set: (s, v) => ({ ...s, confirm: v }),
 *   narrow: (m) => m.type === 'confirm' ? m.msg : null,
 *   sub: dialog.update,
 * })
 * ```
 *
 * **Shorthand** — when the state key matches the message's `type` field and
 * the parent message wraps the child message in a `msg` property:
 *
 * ```ts
 * // Equivalent to the full form above.
 * // Derives get/set/narrow from the key string.
 * sliceHandler('confirm', dialog.update)
 * ```
 *
 * The shorthand assumes the convention:
 * - `state[key]` holds the sub-state
 * - Messages matching this slice have shape `{ type: key; msg: SubMsg }`
 */
export function sliceHandler<S, M, E, SubS, SubM>(
  keyOrOpts:
    | string
    | {
        get: (state: S) => SubS
        set: (state: S, slice: SubS) => S
        narrow: (msg: M) => SubM | null
        sub: (slice: SubS, msg: SubM) => [SubS, E[]]
      },
  sub?: (slice: SubS, msg: SubM) => [SubS, E[]],
): (state: S, msg: M) => [S, E[]] | null {
  if (typeof keyOrOpts === 'string') {
    const key = keyOrOpts
    const update = sub!
    return (state, msg) => {
      const m = msg as { type: string; msg?: unknown }
      if (m.type !== key || !('msg' in m)) return null
      const slice = (state as Record<string, unknown>)[key] as SubS
      const [nextSlice, effects] = update(slice, m.msg as SubM)
      return [{ ...state, [key]: nextSlice } as S, effects]
    }
  }
  const opts = keyOrOpts
  return (state, msg) => {
    const subMsg = opts.narrow(msg)
    if (subMsg === null) return null
    const [nextSlice, effects] = opts.sub(opts.get(state), subMsg)
    return [opts.set(state, nextSlice), effects]
  }
}
