/**
 * Per-each-block reconciliation diff, recorded once per update that
 * mutates an each() block's key set. Dev-only — populated when
 * `installDevTools` has initialized an `_eachDiffLog` on the instance.
 *
 * `updateIndex` correlates with the message-history index recorded by
 * `devtools.ts` so tools can join diffs back to the message that caused
 * them. `eachSiteId` identifies the each() call site stably across
 * updates (currently derived from the block's index in the instance's
 * `structuralBlocks` array at creation time).
 */
export interface EachDiff {
  /**
   * Message-history index at the time the diff was emitted. When messages are
   * batched (multiple send() calls coalescing into one microtask), this is
   * the index of the LAST message in the batch — not necessarily the one that
   * caused the structural change. For per-message correlation, use
   * getMessageHistory with this index as an upper bound.
   */
  updateIndex: number
  /**
   * Stable-ish identifier for the each() call site. Currently derived from the
   * position of the block in `ComponentInstance.structuralBlocks` at the moment
   * of registration, formatted as `each#${N}`.
   *
   * Caveats for consumers:
   * - The counter includes ALL structural blocks (branches, shows, portals,
   *   eaches), not just eaches. So `each#3` means "the 4th structural block",
   *   not "the 4th each".
   * - Blocks registered inside a `branch` arm that switches away are spliced
   *   out; a subsequent each registration can reuse the same N.
   * - Across HMR reloads the ID may drift if the view's structural-block
   *   order changed.
   *
   * For precise correlation across updates, pair with `updateIndex` and the
   * enclosing component's state at that index (retrievable via
   * getMessageHistory).
   */
  eachSiteId: string
  added: string[]
  removed: string[]
  moved: Array<{ key: string; from: number; to: number }>
  reused: string[]
}

export interface RingBuffer<T> {
  push(entry: T): void
  toArray(): T[]
  clear(): void
  size(): number
}

/**
 * Minimal ring buffer: unbounded `push` trimmed to `maxSize` via shift.
 * Kept tiny on purpose — any fancier implementation would pay interest
 * for an allocation-cost saving that only matters under unrealistic
 * dev-only churn. If we ever need it, replace with a circular array.
 */
export function createRingBuffer<T>(maxSize: number): RingBuffer<T> {
  const buf: T[] = []
  return {
    push(entry) {
      if (buf.length >= maxSize) buf.shift()
      buf.push(entry)
    },
    toArray() {
      return buf.slice()
    },
    clear() {
      buf.length = 0
    },
    size() {
      return buf.length
    },
  }
}
