import { describe, it, expect } from 'vitest'
import { extractMsgAnnotations } from '../src/msg-annotations.js'

describe('extractMsgAnnotations', () => {
  it('reads @intent, @requiresConfirm, @humanOnly, @alwaysAffordable from union member JSDoc', () => {
    const source = `
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav', to: 'reports' | 'settings' }
`
    const result = extractMsgAnnotations(source)
    expect(result).toEqual({
      inc: {
        intent: 'Increment the counter',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
      delete: {
        intent: 'Delete item',
        alwaysAffordable: false,
        requiresConfirm: true,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
      checkout: {
        intent: 'Place order',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'human-only',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
      nav: {
        intent: 'Navigate',
        alwaysAffordable: true,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
    })
  })

  // ── @example and @warning ──────────────────────────────────────

  it('extracts a single @example into examples array', () => {
    const src = `
type Msg =
  /** @intent("Save the matrix") @example("dispatch when the user clicks Save") */
  | { type: 'Save' }
`
    expect(extractMsgAnnotations(src)?.Save?.examples).toEqual([
      'dispatch when the user clicks Save',
    ])
  })

  it('extracts multiple @example tags in source order', () => {
    const src = `
type Msg =
  /**
   * @intent("Set a cell value")
   * @example("typical: dispatch from inline cell editor")
   * @example("bulk: prefer Matrix/SetManyCells when setting >5 cells")
   */
  | { type: 'SetCell'; value: number }
`
    expect(extractMsgAnnotations(src)?.SetCell?.examples).toEqual([
      'typical: dispatch from inline cell editor',
      'bulk: prefer Matrix/SetManyCells when setting >5 cells',
    ])
  })

  it('extracts @warning into a separate field, distinct from requiresConfirm', () => {
    const src = `
type Msg =
  /**
   * @intent("Save and overwrite the cloud version")
   * @warning("Overwrites any concurrent edits from other clients without merging.")
   */
  | { type: 'Save' }
`
    const ann = extractMsgAnnotations(src)?.Save
    expect(ann?.warning).toBe('Overwrites any concurrent edits from other clients without merging.')
    expect(ann?.requiresConfirm).toBe(false)
  })

  it('extracts comma-separated effect kinds from @emits', () => {
    // Authored declaration of "this dispatch fires these effects"
    // — the agent reads it before dispatching to reason about
    // batching ("don't dispatch X 100 times each fires cloud-save")
    // and consequence ("delete fires telemetry that can't be undone").
    const src = `
type Msg =
  /**
   * @intent("Save and overwrite the cloud version")
   * @emits("cloud/save", "analytics/track")
   */
  | { type: 'Save' }
`
    expect(extractMsgAnnotations(src)?.Save?.emits).toEqual(['cloud/save', 'analytics/track'])
  })

  it('@emits with a single kind works', () => {
    const src = `
type Msg =
  /** @emits("matrix/persist") */
  | { type: 'Mutate' }
`
    expect(extractMsgAnnotations(src)?.Mutate?.emits).toEqual(['matrix/persist'])
  })

  it('@emits dedupes repeated kinds while preserving first-seen order', () => {
    const src = `
type Msg =
  /** @emits("cloud/save", "cloud/save", "analytics/track") */
  | { type: 'Save' }
`
    expect(extractMsgAnnotations(src)?.Save?.emits).toEqual(['cloud/save', 'analytics/track'])
  })

  it('defaults @emits to [] when absent', () => {
    const src = `
type Msg =
  /** @intent("plain") */
  | { type: 'X' }
`
    expect(extractMsgAnnotations(src)?.X?.emits).toEqual([])
  })

  it('tolerates curly quotes in @example and @warning', () => {
    const src = `
type Msg =
  /**
   * @example(“fancy ok”)
   * @warning(“also fancy”)
   */
  | { type: 'Y' }
`
    const ann = extractMsgAnnotations(src)?.Y
    expect(ann?.examples).toEqual(['fancy ok'])
    expect(ann?.warning).toBe('also fancy')
  })
})

describe('extractMsgAnnotations — edge cases', () => {
  it('returns null when no Msg alias exists', () => {
    expect(extractMsgAnnotations(`type Other = { foo: string }`)).toBeNull()
  })

  it('returns null when the alias is not a union', () => {
    expect(extractMsgAnnotations(`type Msg = { type: 'x' }`)).toBeNull()
  })

  it('skips union members that are not object literals', () => {
    const src = `
type Msg =
  /** @intent("real") */
  | { type: 'ok' }
  | string
  | number
`
    expect(extractMsgAnnotations(src)).toEqual({
      ok: {
        intent: 'real',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
    })
  })

  it('skips union members without a string-literal discriminant', () => {
    const src = `
type Msg =
  /** @intent("real") */
  | { type: 'ok' }
  | { type: string; id: number }
`
    expect(extractMsgAnnotations(src)).toEqual({
      ok: {
        intent: 'real',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
    })
  })

  it('defaults all fields when no JSDoc is attached', () => {
    const src = `
type Msg =
  | { type: 'a' }
  | { type: 'b' }
`
    expect(extractMsgAnnotations(src)).toEqual({
      a: {
        intent: null,
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
      b: {
        intent: null,
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
    })
  })

  it('ignores unknown tags', () => {
    const src = `
type Msg =
  /** @intent("x") @someOtherTag @foo */
  | { type: 'a' }
`
    const r = extractMsgAnnotations(src)
    expect(r?.a).toEqual({
      intent: 'x',
      alwaysAffordable: false,
      requiresConfirm: false,
      dispatchMode: 'shared',
      examples: [],
      warning: null,
      emits: [],
      routeGate: null,
      routeGateReason: null,
    })
  })

  it('prefers the alias literally named Msg over the last union', () => {
    const src = `
type Other =
  /** @intent("wrong") */
  | { type: 'nope' }
type Msg =
  /** @intent("right") */
  | { type: 'ok' }
`
    const r = extractMsgAnnotations(src)
    expect(r).toEqual({
      ok: {
        intent: 'right',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'shared',
        examples: [],
        warning: null,
        emits: [],
        routeGate: null,
        routeGateReason: null,
      },
    })
  })

  it('handles @intent with straight double quotes only (curly optional)', () => {
    const src = `
type Msg =
  /** @intent("straight") */
  | { type: 'a' }
`
    expect(extractMsgAnnotations(src)?.a?.intent).toBe('straight')
  })

  it('@agentOnly sets dispatchMode to agent-only', () => {
    const src = `
type Msg =
  /** @intent("Run bulk import") @agentOnly */
  | { type: 'bulkImport' }
`
    expect(extractMsgAnnotations(src)?.bulkImport).toEqual({
      intent: 'Run bulk import',
      alwaysAffordable: false,
      requiresConfirm: false,
      dispatchMode: 'agent-only',
      examples: [],
      warning: null,
      emits: [],
      routeGate: null,
      routeGateReason: null,
    })
  })

  // The ESLint rule `agent-exclusive-annotations` reports this as an
  // error, but the parser still has to do *something*. Falling back
  // to 'shared' avoids silently locking out one audience based on
  // which tag happens to appear first in the JSDoc.
  it("falls back to 'shared' when both @humanOnly and @agentOnly are present", () => {
    const src = `
type Msg =
  /** @humanOnly @agentOnly */
  | { type: 'confused' }
`
    expect(extractMsgAnnotations(src)?.confused?.dispatchMode).toBe('shared')
  })

  // ── @routeGated ────────────────────────────────────────────────

  it('extracts @routeGated predicate verbatim into routeGate', () => {
    // Compile-time alternative to runtime agentAffordances. The
    // predicate string is captured as-authored; the runtime compiles
    // it lazily and evaluates against state at affordance time.
    const src = `
type Msg =
  /**
   * @intent("Add criteria")
   * @agentOnly
   * @routeGated("state.matrixState.kind === 'loaded'")
   */
  | { type: 'Matrix/AddCriteria' }
`
    const r = extractMsgAnnotations(src)
    expect(r?.['Matrix/AddCriteria']?.routeGate).toBe("state.matrixState.kind === 'loaded'")
  })

  it('routeGate defaults to null when @routeGated is absent', () => {
    const src = `
type Msg =
  /** @intent("Plain") */
  | { type: 'Plain' }
`
    expect(extractMsgAnnotations(src)?.Plain?.routeGate).toBeNull()
  })

  it('extracts the optional @routeGated reason (2nd arg) into routeGateReason', () => {
    const src = `
type Msg =
  /**
   * @intent("Approve")
   * @routeGated("state.step === 'review'", "available during the review step")
   */
  | { type: 'approve' }
`
    const r = extractMsgAnnotations(src)
    expect(r?.approve?.routeGate).toBe("state.step === 'review'")
    expect(r?.approve?.routeGateReason).toBe('available during the review step')
  })

  it('routeGateReason is null when @routeGated has only a predicate', () => {
    const src = `
type Msg =
  /** @routeGated("state.ready") */
  | { type: 'go' }
`
    const r = extractMsgAnnotations(src)
    expect(r?.go?.routeGate).toBe('state.ready')
    expect(r?.go?.routeGateReason).toBeNull()
  })
})
