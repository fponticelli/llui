// Shared row primitives for the keyed-list families (`each` / `virtualEach`): the
// per-row context shape, and the frozen empty sentinels a row that registers no
// teardowns/mounts shares instead of allocating per row.

/** The per-row context a row scope mounts on: its `item` plus the current
 * component `state`. Row bindings read `ctx.item.*` (dep `item.*`) and
 * `ctx.state.*` (dep `state.*`) — so a row can react to BOTH its own item and
 * the component state (e.g. a shared display mode). */
export interface RowCtx<T> {
  item: T
  state: unknown
  /** the row's current position (dep `index`) — for runtime `each` index handles */
  index: number
}

// Shared build-pending / direct-row placeholders. A DIRECT row (RowFactory)
// never registers teardowns or onMount callbacks, so every direct row shares
// these empties instead of allocating two arrays per row (20k on a create-10k;
// the old buildDirectRow wrapper added an object + host box on top). They are
// FROZEN so an accidental mutation throws (in dev) instead of silently corrupting
// sibling rows through the shared reference — the splice sites that drain a row's
// teardowns are length-guarded, so draining a shared-empty list is a no-op that
// never touches the frozen array.
// Declared with their in-use (mutable, for teardowns) element type, then frozen as
// a separate statement — so the declared type is preserved (the sentinel still
// slots into a `Row.teardowns` field) while the runtime array is immutable.
export const EMPTY_ROW_NODES: readonly Node[] = []
export const EMPTY_ROW_TEARDOWNS: Array<() => void> = []
export const EMPTY_ROW_MOUNTS: ReadonlyArray<(root: Element) => void | (() => void)> = []
Object.freeze(EMPTY_ROW_NODES)
Object.freeze(EMPTY_ROW_TEARDOWNS)
Object.freeze(EMPTY_ROW_MOUNTS)
