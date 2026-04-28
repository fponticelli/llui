import { describe, it, expect, vi } from 'vitest'
import {
  handleWouldDispatch,
  type WouldDispatchHost,
} from '../../../src/client/rpc/would-dispatch.js'
import type { MsgSchemaShape } from '../../../src/client/factory.js'

function mkHost(opts: {
  state: unknown
  reducer:
    | ((msg: { type: string; [k: string]: unknown }) => { state: unknown; effects: unknown[] })
    | null
  schema?: MsgSchemaShape | null
}): WouldDispatchHost {
  return {
    getState: () => opts.state,
    runReducer: opts.reducer ?? (() => null),
    getMsgSchema: () => opts.schema ?? null,
  }
}

describe('handleWouldDispatch', () => {
  it('returns predicted stateDiff and effects without committing', () => {
    type S = { count: number }
    const state: S = { count: 5 }
    const result = handleWouldDispatch(
      mkHost({
        state,
        reducer: (msg) => {
          if (msg.type === 'inc') return { state: { count: 6 }, effects: [] }
          return { state, effects: [] }
        },
      }),
      { msg: { type: 'inc' } },
    )
    expect(result.status).toBe('predicted')
    if (result.status === 'predicted') {
      expect(result.stateDiff).toEqual([{ op: 'replace', path: '/count', value: 6 }])
      expect(result.effects).toEqual([])
    }
  })

  it('surfaces the would-fire effects without invoking them', () => {
    // The whole point of the API: the agent learns what *would* fire
    // before deciding to commit. The effects are returned literally
    // (whatever the reducer produced) — the runtime never invokes
    // them.
    const reducer = vi.fn(() => ({
      state: { saved: true },
      effects: [{ kind: 'cloud/save' }, { kind: 'analytics/track', event: 'matrix_save' }],
    }))
    const result = handleWouldDispatch(mkHost({ state: { saved: false }, reducer }), {
      msg: { type: 'Save' },
    })
    if (result.status === 'predicted') {
      expect(result.effects).toEqual([
        { kind: 'cloud/save' },
        { kind: 'analytics/track', event: 'matrix_save' },
      ])
    }
    // Reducer ran exactly once — predict-only dispatch shouldn't
    // double-call.
    expect(reducer).toHaveBeenCalledOnce()
  })

  it('empty stateDiff when the reducer returns the same state reference', () => {
    // Reducers that no-op (Object.is(prev, next)) produce no diff
    // entries. The agent uses an empty diff as a signal that the
    // candidate dispatch wouldn't change anything.
    const state = { x: 1 }
    const result = handleWouldDispatch(mkHost({ state, reducer: () => ({ state, effects: [] }) }), {
      msg: { type: 'noop' },
    })
    if (result.status === 'predicted') {
      expect(result.stateDiff).toEqual([])
    }
  })

  it('rejects malformed msg (missing type)', () => {
    const result = handleWouldDispatch(
      mkHost({ state: {}, reducer: () => ({ state: {}, effects: [] }) }),
      // @ts-expect-error intentional
      { msg: { notType: 'oops' } },
    )
    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid',
      detail: expect.stringContaining('type'),
    })
  })

  it('rejects when the host has no reducer (e.g. test harness without instance)', () => {
    const result = handleWouldDispatch(mkHost({ state: {}, reducer: null }), { msg: { type: 'X' } })
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect(result.reason).toBe('unsupported')
    }
  })

  // ── Schema-driven preflight ───────────────────────────────────

  it('rejects schema-mismatched msg without running the reducer', () => {
    // The motivating case: the agent ships an out-of-enum value. The
    // validator catches it before the reducer fires, so the agent gets
    // structured feedback without burning a real dispatch round trip.
    const reducer = vi.fn(() => ({ state: {}, effects: [] }))
    const result = handleWouldDispatch(
      mkHost({
        state: {},
        reducer,
        schema: {
          discriminant: 'type',
          variants: { 'Cell/SetRating': { value: { enum: [1, 2, 3, 4, 5] } } },
        },
      }),
      { msg: { type: 'Cell/SetRating', value: 6 } },
    )
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected' && result.reason === 'schema-mismatch') {
      expect(result.errors[0]).toMatchObject({ path: 'value', code: 'not-in-enum' })
    } else {
      throw new Error('expected schema-mismatch rejection')
    }
    expect(reducer).not.toHaveBeenCalled()
  })

  it('rejects discriminated-union msg with unknown discriminant', () => {
    // Sends format with kind: 'logarithmic' when only 'exact', 'range',
    // 'compound' are legal. The error path points at the discriminant
    // field with the legal list inline.
    const reducer = vi.fn(() => ({ state: {}, effects: [] }))
    const result = handleWouldDispatch(
      mkHost({
        state: {},
        reducer,
        schema: {
          discriminant: 'type',
          variants: {
            'Cell/SetFormat': {
              format: {
                kind: 'discriminated-union',
                discriminant: 'kind',
                variants: {
                  exact: {},
                  range: { min: 'number', max: 'number' },
                },
              },
            },
          },
        },
      }),
      { msg: { type: 'Cell/SetFormat', format: { kind: 'logarithmic', base: 10 } } },
    )
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected' && result.reason === 'schema-mismatch') {
      expect(result.errors[0]).toMatchObject({
        path: 'format.kind',
        code: 'unknown-discriminant-value',
      })
    } else {
      throw new Error('expected schema-mismatch rejection')
    }
    expect(reducer).not.toHaveBeenCalled()
  })

  it('passes valid schema-conforming msg through to the reducer', () => {
    const reducer = vi.fn(() => ({ state: { rated: 4 }, effects: [] }))
    const result = handleWouldDispatch(
      mkHost({
        state: { rated: null },
        reducer,
        schema: {
          discriminant: 'type',
          variants: { 'Cell/SetRating': { value: { enum: [1, 2, 3, 4, 5] } } },
        },
      }),
      { msg: { type: 'Cell/SetRating', value: 4 } },
    )
    expect(result.status).toBe('predicted')
    expect(reducer).toHaveBeenCalledOnce()
  })

  it('skips schema validation when schema is null (reducer still runs)', () => {
    // Backward-compat path: hosts that don't ship a schema (older
    // builds, test harnesses) get the same semantics as before — only
    // the reducer-level checks. The tool stays permissive when the
    // agent's schema source is missing.
    const reducer = vi.fn(() => ({ state: {}, effects: [] }))
    const result = handleWouldDispatch(mkHost({ state: {}, reducer, schema: null }), {
      msg: { type: 'AnyVariant', anything: 'goes' },
    })
    expect(result.status).toBe('predicted')
    expect(reducer).toHaveBeenCalledOnce()
  })

  // ── Reducer throw mid-prediction ───────────────────────────────

  it('surfaces a reducer throw as `reducer-threw` instead of HTTP 500', () => {
    // The agent uses `would_dispatch` to weigh a candidate before
    // committing. If the reducer throws while predicting, the agent
    // should learn that — not get an opaque transport failure that
    // reads as "the tool itself broke." The structured `reducer-threw`
    // status tells the agent: the Msg shape was accepted but the
    // reducer errored; usually means earlier state needs fixing.
    const reducer = vi.fn(() => {
      throw new Error('scoring crashed: unexpected ease value')
    })
    const result = handleWouldDispatch(mkHost({ state: {}, reducer }), {
      msg: { type: 'Run' },
    })
    expect(result.status).toBe('reducer-threw')
    if (result.status === 'reducer-threw') {
      expect(result.message).toContain('scoring crashed')
    }
  })

  it('reducer-threw includes a truncated stack for debugging', () => {
    const reducer = vi.fn(() => {
      const e = new Error('boom')
      throw e
    })
    const result = handleWouldDispatch(mkHost({ state: {}, reducer }), {
      msg: { type: 'X' },
    })
    if (result.status === 'reducer-threw') {
      // Stack present (Error has a stack on every modern runtime).
      expect(result.stack).toBeDefined()
    }
  })

  it('does not affect host state — predict is non-mutating', () => {
    // The reducer is pure by TEA contract; the host's getState
    // pointer doesn't change as a result of prediction.
    const state = { count: 0 }
    const host = mkHost({
      state,
      reducer: (msg) =>
        msg.type === 'inc' ? { state: { count: 1 }, effects: [] } : { state, effects: [] },
    })
    handleWouldDispatch(host, { msg: { type: 'inc' } })
    expect(host.getState()).toBe(state) // same reference
    expect((host.getState() as { count: number }).count).toBe(0) // unchanged
  })
})
