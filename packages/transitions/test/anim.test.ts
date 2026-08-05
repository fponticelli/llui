import { describe, it, expect } from 'vitest'
import { createRunScope } from '../src/anim'

// Unit coverage for the per-element run registry that gives the transition
// helpers their interruption semantics. The `settle` half exists for REUSED
// elements: a completed leave keeps its rollback registered (so a later phase
// can undo the resting values it deliberately left behind) while no longer
// counting as in-flight.
describe('createRunScope()', () => {
  const makeEl = (): HTMLElement => document.createElement('div')

  it('reports a freshly registered run as current and active', () => {
    const runs = createRunScope()
    const el = makeEl()
    const token = runs.register(el, () => {})
    expect(runs.isCurrent(el, token)).toBe(true)
    expect(runs.isActive(el)).toBe(true)
  })

  it('supersede fires the rollback and clears the run', () => {
    const runs = createRunScope()
    const el = makeEl()
    let rolledBack = 0
    const token = runs.register(el, () => {
      rolledBack++
    })

    runs.supersede(el)
    expect(rolledBack).toBe(1)
    expect(runs.isCurrent(el, token)).toBe(false)
    expect(runs.isActive(el)).toBe(false)

    // Idempotent: nothing left to roll back.
    runs.supersede(el)
    expect(rolledBack).toBe(1)
  })

  it('end clears the run WITHOUT firing its rollback', () => {
    const runs = createRunScope()
    const el = makeEl()
    let rolledBack = 0
    const token = runs.register(el, () => {
      rolledBack++
    })

    runs.end(el, token)
    expect(rolledBack).toBe(0)
    expect(runs.isActive(el)).toBe(false)

    // The entry is gone, so a later supersede has nothing to undo.
    runs.supersede(el)
    expect(rolledBack).toBe(0)
  })

  it('end on a superseded token leaves the newer run untouched', () => {
    const runs = createRunScope()
    const el = makeEl()
    const stale = runs.register(el, () => {})
    runs.supersede(el)
    let newerRolledBack = 0
    runs.register(el, () => {
      newerRolledBack++
    })

    runs.end(el, stale)
    expect(runs.isActive(el)).toBe(true)

    runs.supersede(el)
    expect(newerRolledBack).toBe(1)
  })

  // ── settle: the reused-element seam ──
  it('settle keeps the rollback registered for a later supersede', () => {
    const runs = createRunScope()
    const el = makeEl()
    let rolledBack = 0
    const token = runs.register(el, () => {
      rolledBack++
    })

    runs.settle(el, token)
    expect(rolledBack).toBe(0) // settling never fires the rollback itself

    // A later phase on the SAME element rolls the settled run's residue back.
    runs.supersede(el)
    expect(rolledBack).toBe(1)
  })

  it('settle marks the run no longer in-flight', () => {
    const runs = createRunScope()
    const el = makeEl()
    const token = runs.register(el, () => {})

    expect(runs.isActive(el)).toBe(true)
    runs.settle(el, token)
    // The rollback is still registered, but nothing is animating — a later
    // leave must not mistake this for an enter it is interrupting.
    expect(runs.isActive(el)).toBe(false)
    expect(runs.isCurrent(el, token)).toBe(true)
  })

  it('settle on a superseded token is a no-op', () => {
    const runs = createRunScope()
    const el = makeEl()
    const stale = runs.register(el, () => {})
    runs.supersede(el)
    runs.register(el, () => {})

    runs.settle(el, stale)
    // The newer run is untouched — still in flight.
    expect(runs.isActive(el)).toBe(true)
  })

  it('scopes are independent per bundle', () => {
    const a = createRunScope()
    const b = createRunScope()
    const el = makeEl()
    let aRolledBack = 0
    a.register(el, () => {
      aRolledBack++
    })

    // A phase in bundle B must not disturb bundle A's run on the same element
    // (this is what lets mergeTransitions compose fade + slide).
    b.supersede(el)
    expect(aRolledBack).toBe(0)
    expect(a.isActive(el)).toBe(true)
  })
})
