// Signal runtime — the Phase-2 binding driver for signal-compiled components.
//
// Built ALONGSIDE the existing mask/maskHi runtime (per-file-flip migration):
// signal-compiled components use this chunked-mask driver; legacy components keep
// the existing gate until migrated. No change to the live binding path.
//
// Each binding pairs a sparse chunked mask (which dependency bits it reads) with
// a `produce(state)` (the compiled accessor expression) and a `commit(value)`
// (the DOM mutation). On update the driver:
//   1. computes the dirty chunk-set from old→new state (ref-equality per path),
//   2. gates: skip any binding whose mask doesn't intersect dirty (never even
//      calls produce),
//   3. output-equality: calls produce, commits only if the value actually
//      changed — so a coarse dependency wastes a produce but never a DOM write.
//
// See docs/proposals/signals/README.md "Runtime — output equality check".

import { type PathTable, type SparseMask, computeDirty, intersects } from './mask.js'

export interface SignalBinding<V = unknown> {
  /** the chunks/bits this binding depends on */
  readonly mask: SparseMask
  /** evaluate the compiled accessor expression against the current state */
  produce(state: unknown): V
  /** apply the produced value (DOM mutation) — called only when it changed */
  commit(value: V): void
}

export interface SignalScope {
  /** mount: run every binding once against the initial state */
  mount(state: unknown): void
  /** update: gate by dirty bits, commit only changed values */
  update(oldState: unknown, newState: unknown): void
}

/**
 * Create a Phase-2 reconciler over a flat binding array gated by a chunked-mask
 * path table.
 */
export function createSignalScope(
  table: PathTable,
  bindings: readonly SignalBinding[],
): SignalScope {
  const last = new Map<SignalBinding, unknown>()

  return {
    mount(state: unknown): void {
      for (const b of bindings) {
        const v = b.produce(state)
        b.commit(v)
        last.set(b, v)
      }
    },

    update(oldState: unknown, newState: unknown): void {
      const dirty = computeDirty(table, oldState, newState)
      for (const b of bindings) {
        if (!intersects(b.mask, dirty)) continue // gate: irrelevant binding
        const v = b.produce(newState)
        if (!Object.is(v, last.get(b))) {
          b.commit(v) // output-equality: only commit real changes
          last.set(b, v)
        }
      }
    },
  }
}
