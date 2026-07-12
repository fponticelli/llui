// RowStateGate — the state-fanout gating a keyed list (`each` / `virtualEach`) uses
// to decide, per reconcile, whether a component-state change must re-evaluate EVERY
// row (fan out) or only the rows whose item changed.
//
// A row template that reads component state ONLY via known value paths (`state.foo`)
// is "gatable": the gate captures those paths and, on a reconcile, compares their
// current values against the previous reconcile's snapshot — skipping the all-row
// sweep when none changed (the ticker tick that bumps `tickCount` but not
// `displayMode`). Anything the gate can't see through — a structural child
// (show/branch/each whose arm reads state lazily), a rebased connect-part, or a
// whole-`state` read — makes the list ungatable and forces a sweep on every state
// change.
//
// Invariants (previously implicit in `dom.ts` comments):
//
//  • MONOTONIC "reads state": `markReadsState()` only ever latches ON. A
//    data-conditional render may have the first row read no state and a later row
//    read it, so the default sweep decision can never be latched false from one row.
//
//  • LATCHED "gating off": `disableGating()` is a one-way latch — once a single row
//    is ungatable, the whole list falls back to sweeping on every state change, and
//    later gatable rows can NOT re-enable gating (`captureGatablePaths` no-ops).
//
//  • RESET on path growth: capturing a newly-seen state path rebuilds the split
//    segment arrays and invalidates the value snapshot (`prevStateVals = null`),
//    forcing one conservative sweep + a recapture on the next reconcile (the old
//    snapshot was sized for the old path set).
//
// The caller owns per-row CLASSIFICATION (what counts as gatable); the gate owns
// the flag/snapshot bookkeeping and the reconcile-time sweep decision. `each` and
// `virtualEach` feed it their own observations (see their `build*` functions).

import { resolveSegments } from './mask.js'

export class RowStateGate {
  // Whether ANY built row template reads component state (`state` / `state.*` deps,
  // after rebasing). Accumulated MONOTONICALLY — never latched false from one row.
  // When it stays false, a row whose item + index are unchanged needs no
  // re-evaluation even though the component-state ref changed.
  private templateReadsState = false
  // Gating stays viable only while every state-reading row is cheaply gatable. A
  // divergent (ungatable) row flips this off PERMANENTLY.
  private gatingViable = true
  // True when the captured `statePathSet` is a complete, sound description of what
  // the rows read from component state — so the per-path value compare is a valid
  // substitute for sweeping. Implies `templateReadsState`.
  private stateGatable = false
  private readonly statePathSet = new Set<string>()
  // Pre-split segment arrays for the captured paths (no per-reconcile `String.split`).
  private rowStateSegs: string[][] = []
  // Previous reconcile's values for `rowStateSegs`, reused in place; null forces a
  // conservative sweep + recapture (baseline missing or resized).
  private prevStateVals: unknown[] | null = null

  /** Has any row read component state? Drives the default (conservative) sweep. */
  get readsState(): boolean {
    return this.templateReadsState
  }

  /** Is gating still viable (no ungatable row seen yet)? `each` guards its per-row
   * capture with this to match the original short-circuit; once false it stays false. */
  get canGate(): boolean {
    return this.gatingViable
  }

  /** Latch: some row reads component state (monotonic — only ever turns ON). */
  markReadsState(): void {
    this.templateReadsState = true
  }

  /** Latch OFF: a row that can't be gated (structural child / rebased part /
   * whole-`state` read). Every state change now sweeps all rows, permanently. */
  disableGating(): void {
    this.gatingViable = false
    this.stateGatable = false
  }

  /** Capture the component-state value paths a GATABLE state-reading row reads
   * (each path already stripped of its `state.` prefix). No-op once gating has been
   * latched off. Growing the captured set rebuilds the split segments and forces a
   * recapture (see the RESET invariant). Callers pass a non-empty path set. */
  captureGatablePaths(paths: Iterable<string>): void {
    if (!this.gatingViable) return
    const before = this.statePathSet.size
    for (const p of paths) this.statePathSet.add(p)
    this.stateGatable = true
    if (this.statePathSet.size !== before) {
      this.rowStateSegs = [...this.statePathSet].map((p) => p.split('.'))
      this.prevStateVals = null
    }
  }

  /**
   * Reconcile-time decision: must this state re-evaluate EVERY row?
   *
   * Returns the conservative default (`readsState`) unless the list is gatable, in
   * which case it returns true only when a captured state path's value changed
   * since the last call. ALWAYS refreshes the value snapshot as a side effect, so a
   * subsequent call compares against this reconcile's values. Call exactly once per
   * reconcile, before the per-row update sweep.
   */
  shouldSweep(rowState: unknown): boolean {
    let sweep = this.templateReadsState
    if (this.stateGatable) {
      if (this.prevStateVals !== null) {
        sweep = false
        for (let j = 0; j < this.rowStateSegs.length; j++) {
          if (!Object.is(resolveSegments(rowState, this.rowStateSegs[j]!), this.prevStateVals[j])) {
            sweep = true
            break
          }
        }
      }
      // Fill the reused buffer in place (resize only when the path set grew).
      if (this.prevStateVals === null || this.prevStateVals.length !== this.rowStateSegs.length) {
        this.prevStateVals = new Array<unknown>(this.rowStateSegs.length)
      }
      for (let j = 0; j < this.rowStateSegs.length; j++) {
        this.prevStateVals[j] = resolveSegments(rowState, this.rowStateSegs[j]!)
      }
    }
    return sweep
  }
}
