import { describe, it, expect } from 'vitest'
import { RowStateGate } from '../../src/signals/row-state-gate'

// Focused unit tests for the state-fanout gate extracted from `signalEach` /
// `signalVirtualEach`. These pin the invariants that were previously only implicit
// in the inline comments: MONOTONIC "reads state", LATCHED "gating off", RESET on
// captured-path growth, and the per-reconcile sweep decision.

describe('RowStateGate', () => {
  it('a list whose rows read no state never sweeps', () => {
    const gate = new RowStateGate()
    expect(gate.readsState).toBe(false)
    expect(gate.canGate).toBe(true)
    expect(gate.shouldSweep({ count: 1 })).toBe(false)
    expect(gate.shouldSweep({ count: 2 })).toBe(false)
  })

  it('a state-reading but UNGATABLE row (no captured paths) always sweeps', () => {
    // The `each` shape for a whole-`state` read / rebased part: markReadsState with
    // no captureGatablePaths → conservative sweep on every state change.
    const gate = new RowStateGate()
    gate.markReadsState()
    expect(gate.readsState).toBe(true)
    expect(gate.shouldSweep({})).toBe(true)
    expect(gate.shouldSweep({})).toBe(true)
  })

  it('gates on a captured path: sweeps only when that path value changes', () => {
    const gate = new RowStateGate()
    gate.markReadsState()
    gate.captureGatablePaths(['count'])
    // First reconcile: no baseline yet → one forced (conservative) sweep + capture.
    expect(gate.shouldSweep({ count: 1, mode: 'a' })).toBe(true)
    // count unchanged (mode changed but is not a captured path) → skip the sweep.
    expect(gate.shouldSweep({ count: 1, mode: 'b' })).toBe(false)
    // count changed → sweep.
    expect(gate.shouldSweep({ count: 2, mode: 'b' })).toBe(true)
    // stable again.
    expect(gate.shouldSweep({ count: 2, mode: 'c' })).toBe(false)
  })

  it('a fresh state ref with the same captured value does NOT sweep (per-path, not per-ref)', () => {
    const gate = new RowStateGate()
    gate.markReadsState()
    gate.captureGatablePaths(['user.name'])
    expect(gate.shouldSweep({ user: { name: 'x' }, n: 1 })).toBe(true) // baseline
    // brand-new state object, brand-new user object — but name unchanged.
    expect(gate.shouldSweep({ user: { name: 'x' }, n: 2 })).toBe(false)
    // nested value changed → sweep.
    expect(gate.shouldSweep({ user: { name: 'y' }, n: 2 })).toBe(true)
  })

  it('RESET: capturing a newly-seen path forces one conservative sweep, then re-gates', () => {
    const gate = new RowStateGate()
    gate.markReadsState()
    gate.captureGatablePaths(['count'])
    expect(gate.shouldSweep({ count: 1, size: 5 })).toBe(true) // baseline for [count]
    expect(gate.shouldSweep({ count: 1, size: 5 })).toBe(false) // count stable
    // A later row reads an additional path → the captured set grows.
    gate.captureGatablePaths(['size'])
    // Baseline was sized for the old set → one forced sweep + recapture.
    expect(gate.shouldSweep({ count: 1, size: 5 })).toBe(true)
    // Now gates on BOTH paths.
    expect(gate.shouldSweep({ count: 1, size: 5 })).toBe(false)
    expect(gate.shouldSweep({ count: 1, size: 6 })).toBe(true) // the new path changed
    expect(gate.shouldSweep({ count: 3, size: 6 })).toBe(true) // the old path changed
  })

  it('capturing an already-seen path does NOT reset the baseline (no spurious sweep)', () => {
    const gate = new RowStateGate()
    gate.markReadsState()
    gate.captureGatablePaths(['count'])
    expect(gate.shouldSweep({ count: 1 })).toBe(true) // baseline
    expect(gate.shouldSweep({ count: 1 })).toBe(false)
    // A sibling row reads the SAME path — set does not grow, baseline intact.
    gate.captureGatablePaths(['count'])
    expect(gate.shouldSweep({ count: 1 })).toBe(false)
  })

  it('LATCH: an ungatable row disables gating permanently; later captures cannot re-enable it', () => {
    const gate = new RowStateGate()
    gate.markReadsState()
    gate.captureGatablePaths(['count'])
    expect(gate.shouldSweep({ count: 1 })).toBe(true)
    expect(gate.shouldSweep({ count: 1 })).toBe(false) // gated

    gate.disableGating()
    expect(gate.canGate).toBe(false)
    // Now every state change sweeps, regardless of the captured path's value.
    expect(gate.shouldSweep({ count: 1 })).toBe(true)
    expect(gate.shouldSweep({ count: 1 })).toBe(true)

    // A later gatable row cannot re-enable gating (the capture is a no-op).
    gate.captureGatablePaths(['other'])
    expect(gate.canGate).toBe(false)
    expect(gate.shouldSweep({ count: 1, other: 9 })).toBe(true)
    expect(gate.shouldSweep({ count: 1, other: 9 })).toBe(true)
  })

  it('MONOTONIC: markReadsState only ever latches ON', () => {
    const gate = new RowStateGate()
    expect(gate.readsState).toBe(false)
    gate.markReadsState()
    expect(gate.readsState).toBe(true)
    // there is no un-mark — a later no-state row cannot clear it (nothing to call).
    expect(gate.readsState).toBe(true)
  })
})
