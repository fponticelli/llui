export interface StructuralBlock {
  /** Bitmask of state fields this block depends on. If set, the block
   *  is skipped when `(mask & dirtyMask) === 0`. FULL_MASK (default)
   *  means always run. */
  mask: number
  reconcile(state: unknown, dirtyMask: number): void
}
