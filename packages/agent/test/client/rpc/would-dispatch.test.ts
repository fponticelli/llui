import { describe, it, expect, vi } from 'vitest'
import {
  handleWouldDispatch,
  type WouldDispatchHost,
} from '../../../src/client/rpc/would-dispatch.js'

function mkHost(opts: {
  state: unknown
  reducer:
    | ((msg: { type: string; [k: string]: unknown }) => { state: unknown; effects: unknown[] })
    | null
}): WouldDispatchHost {
  return {
    getState: () => opts.state,
    runReducer: opts.reducer ?? (() => null),
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
