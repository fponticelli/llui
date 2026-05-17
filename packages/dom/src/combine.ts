// Reducer composition for slice-based decomposition.
//
// `combine()` is the canonical way to compose multiple sub-reducers into
// a single top-level reducer. Each slice owns a sub-tree of state and an
// independent `(slice, msg) → [slice, effects]` reducer; the host's
// state shape nests these slices as top-level keys; messages are routed
// to slices by namespace (`{type: 'slice/action', ...}` → `slice`'s
// reducer).
//
// This is the load-bearing piece of the unified-composition-model: it
// replaces the per-component `update()` machinery that `child()` /
// `component()` previously gave you. A slice is just a module exporting
// `update` + (optionally) `view` functions. Hosts wire them together
// with `combine()`.
//
// See `docs/proposals/unified-composition-model.md`.

/**
 * A slice reducer — operates on a sub-tree of host state plus its own
 * message variants, returns the next sub-tree and effects to dispatch.
 * Effects from slice reducers bubble up to the top-level effect handler
 * unchanged.
 */
export type SliceReducer<Slice, Msg, Effect> = (state: Slice, msg: Msg) => [Slice, Effect[]]

/**
 * Map of slice name → its reducer. The slice name is BOTH:
 *   - The top-level state key the slice lives under (`s[name]`)
 *   - The message-namespace prefix that routes to this slice
 *     (`{type: 'name/action'}` → routes to slice `name`)
 *
 * The matching state shape's top-level keys must therefore be the same
 * set as the routing prefixes — TypeScript enforces this via the `S`
 * generic. Messages whose `type` doesn't start with `${name}/` (or
 * doesn't contain `/` at all) fall through to the optional `_top`
 * reducer below.
 */
// The Msg generic isn't used directly here — slice reducers carry their
// own Msg variants. The host's `M` union enforces routing correctness
// at the `combine()` call site (the returned reducer is typed `(S, M)`).
export type SliceMap<S, _M, E> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof S]?: SliceReducer<S[K], any, E>
}

/**
 * Optional top-level reducer for messages that don't match any slice
 * prefix. Use for cross-cutting messages (e.g. `{type: 'reset'}`) or
 * messages that operate on multiple slices at once.
 */
export type TopReducer<S, M, E> = (state: S, msg: M) => [S, E[]]

/**
 * Compose slice reducers into a single top-level reducer.
 *
 * ```ts
 * type AppState = { matrix: MatrixState; ui: UiState }
 * type AppMsg =
 *   | { type: 'matrix/setName'; v: string }
 *   | { type: 'ui/toggleSidebar' }
 *   | { type: 'reset' }
 *
 * const update = combine<AppState, AppMsg, AppEffect>({
 *   matrix: matrixUpdate,
 *   ui:     uiUpdate,
 * }, (s, msg) => {
 *   if (msg.type === 'reset') return [initialState(), []]
 *   return [s, []]
 * })
 * ```
 *
 * Routing:
 *   - `{type: 'matrix/setName'}` → `matrixUpdate(s.matrix, msg)`. The slice
 *     reducer sees the FULL message (including the `matrix/` prefix); the
 *     slice's own update body matches on `.type`. This is intentional: it
 *     keeps slice reducers usable standalone in unit tests.
 *   - `{type: 'reset'}` → routes to the optional top reducer (the second
 *     argument). If `_top` is absent, the message is a no-op (state
 *     unchanged, no effects).
 *
 * Effects bubble: slice reducers and the top reducer can both return
 * effects; combine concatenates them into the returned array in
 * source order.
 *
 * @param slices Map of slice name → reducer
 * @param _top Optional cross-cutting reducer for unprefixed messages
 */
export function combine<S, M extends { type: string }, E>(
  slices: SliceMap<S, M, E>,
  _top?: TopReducer<S, M, E>,
): (state: S, msg: M) => [S, E[]] {
  return (state: S, msg: M): [S, E[]] => {
    // Find the slice this message routes to. Convention: msg.type is
    // `${slice}/${action}`. Anything else falls through to _top.
    const slashIdx = msg.type.indexOf('/')
    if (slashIdx > 0) {
      const sliceName = msg.type.slice(0, slashIdx) as keyof S
      const reducer = slices[sliceName]
      if (reducer !== undefined) {
        const slice = state[sliceName]
        const [nextSlice, effects] = reducer(slice, msg)
        if (Object.is(nextSlice, slice)) {
          // No state change — preserve top-level reference too.
          return [state, effects]
        }
        return [{ ...state, [sliceName]: nextSlice }, effects]
      }
      // Slice name didn't match — fall through to top.
    }
    if (_top) return _top(state, msg)
    return [state, []]
  }
}
