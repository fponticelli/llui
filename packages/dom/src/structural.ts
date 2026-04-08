export interface StructuralBlock {
  /** Bitmask of state fields this block depends on. If set, the block
   *  is skipped when `(mask & dirtyMask) === 0`. FULL_MASK (default)
   *  means always run. */
  mask: number
  reconcile(state: unknown, dirtyMask: number): void
  /** Same keys, only item data changed — skip mismatch/swap detection */
  reconcileItems?(state: unknown): void
  /** Remove all items — skip items accessor, go straight to clear path */
  reconcileClear?(): void
  /** Remove entries whose keys are no longer in the new items array.
   *  Avoids Map/Set allocation — linear scan with early exit. */
  reconcileRemove?(state: unknown): void
}
