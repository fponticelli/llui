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
      },
      delete: {
        intent: 'Delete item',
        alwaysAffordable: false,
        requiresConfirm: true,
        dispatchMode: 'shared',
      },
      checkout: {
        intent: 'Place order',
        alwaysAffordable: false,
        requiresConfirm: false,
        dispatchMode: 'human-only',
      },
      nav: {
        intent: 'Navigate',
        alwaysAffordable: true,
        requiresConfirm: false,
        dispatchMode: 'shared',
      },
    })
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
      ok: { intent: 'real', alwaysAffordable: false, requiresConfirm: false, dispatchMode: 'shared' },
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
      ok: { intent: 'real', alwaysAffordable: false, requiresConfirm: false, dispatchMode: 'shared' },
    })
  })

  it('defaults all fields when no JSDoc is attached', () => {
    const src = `
type Msg =
  | { type: 'a' }
  | { type: 'b' }
`
    expect(extractMsgAnnotations(src)).toEqual({
      a: { intent: null, alwaysAffordable: false, requiresConfirm: false, dispatchMode: 'shared' },
      b: { intent: null, alwaysAffordable: false, requiresConfirm: false, dispatchMode: 'shared' },
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
      ok: { intent: 'right', alwaysAffordable: false, requiresConfirm: false, dispatchMode: 'shared' },
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
})
