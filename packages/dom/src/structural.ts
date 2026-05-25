export interface StructuralBlock {
  /** Bitmask of state prefixes this block depends on (bits 0..30).
   *  Paired with `maskHi` for bits 31..61. The block runs when
   *  `(mask & dirtyLo) | (maskHi & dirtyHi)` is non-zero. FULL_MASK
   *  (default) for `mask` means always run, regardless of `maskHi`. */
  mask: number
  /** High-word bits 31..61, encoded with `1 << (pos - 31)`. Zero for
   *  blocks that only read paths 0..30. */
  maskHi: number
  /** Dev-only stable id assigned at construction (each/branch/show/scope).
   *  Used by the runtime trace ring buffer; production builds omit. */
  __siteId?: string
  reconcile(state: unknown, dirtyMask: number, dirtyMaskHi: number): void
  /** Same keys, only item data changed — skip mismatch/swap detection */
  reconcileItems?(state: unknown): void
  /** Remove all items — skip items accessor, go straight to clear path */
  reconcileClear?(): void
  /** Remove entries whose keys are no longer in the new items array.
   *  Avoids Map/Set allocation — linear scan with early exit. */
  reconcileRemove?(state: unknown): void
  /** Update only the entries at the given indices — O(k) instead of O(n).
   *  Used when the compiler detects which indices the update loop modifies. */
  reconcileChanged?(state: unknown, stride: number): void
  /**
   * Optional self-heal callback invoked by the runtime after a Phase 1
   * pass when an ancestor structural primitive (`branch` / `show`) swapped
   * arms during the cycle. Arm swaps can move a block's anchor comments
   * into a freshly-built wrapper element without bringing along the
   * block's currently-rendered entries — see "Pattern 4 stale-Node[]
   * capture" in `primitives/each.ts`. Implementers should: (1) re-bind
   * `parent = anchor.parentNode`, (2) re-attach drifted entries between
   * the boundary comments, (3) run any items reconcile that the earlier
   * Phase 1 pass skipped because `anchor.parentNode` was null at the
   * time. Cheap when nothing changed: one parentNode comparison.
   */
  rebindParent?(state: unknown): void
}
