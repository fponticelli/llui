import { describe, it, expect } from 'vitest'
import { replayTrace, type LluiTrace } from '../src/replay-trace'
import { component } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ count: state.count + 1 }, []]
      case 'dec':
        return [{ count: Math.max(0, state.count - 1) }, []]
    }
  },
  view: () => [],
})

describe('replayTrace', () => {
  it('replays a trace successfully when states match', () => {
    const trace: LluiTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        { msg: { type: 'inc' }, expectedState: { count: 1 }, expectedEffects: [] },
        { msg: { type: 'inc' }, expectedState: { count: 2 }, expectedEffects: [] },
        { msg: { type: 'dec' }, expectedState: { count: 1 }, expectedEffects: [] },
      ],
    }

    // Should not throw
    replayTrace(Counter, trace)
  })

  it('throws when state diverges', () => {
    const trace: LluiTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        { msg: { type: 'inc' }, expectedState: { count: 1 }, expectedEffects: [] },
        { msg: { type: 'inc' }, expectedState: { count: 999 }, expectedEffects: [] }, // wrong!
      ],
    }

    expect(() => replayTrace(Counter, trace)).toThrow(/step 1/)
  })

  it('throws when effects diverge', () => {
    type Eff = { type: 'log'; message: string }
    const WithEffects = component<State, Msg, Eff>({
      name: 'WithEffects',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ count: state.count + 1 }, [{ type: 'log', message: 'incremented' }]]
          case 'dec':
            return [{ count: state.count - 1 }, []]
        }
      },
      view: () => [],
    })

    const trace: LluiTrace<State, Msg, Eff> = {
      lluiTrace: 1,
      component: 'WithEffects',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        {
          msg: { type: 'inc' },
          expectedState: { count: 1 },
          expectedEffects: [{ type: 'log', message: 'wrong message' }],
        },
      ],
    }

    expect(() => replayTrace(WithEffects, trace)).toThrow(/step 0/)
  })

  it('matches an http-shaped effect whose onSuccess/onError callbacks differ by identity', () => {
    // Effects commonly carry function fields (http onSuccess/onError, storage
    // onLoad, websocket onMessage). Those functions can never be recorded in a
    // trace and are fresh instances each `update()`, so the comparison must skip
    // them and match on the JSON-serializable data (type, url, …).
    type Eff = {
      type: 'http'
      url: string
      onSuccess: (data: unknown) => Msg
      onError: (err: unknown) => Msg
    }
    const Loader = component<State, Msg, Eff>({
      name: 'Loader',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [
              { count: state.count + 1 },
              [
                {
                  type: 'http',
                  url: '/api/data',
                  onSuccess: () => ({ type: 'inc' }),
                  onError: () => ({ type: 'dec' }),
                },
              ],
            ]
          case 'dec':
            return [{ count: state.count - 1 }, []]
        }
      },
      view: () => [],
    })

    const trace: LluiTrace<State, Msg, Eff> = {
      lluiTrace: 1,
      component: 'Loader',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        {
          msg: { type: 'inc' },
          expectedState: { count: 1 },
          // Distinct callback instances — must not cause a false divergence.
          expectedEffects: [
            {
              type: 'http',
              url: '/api/data',
              onSuccess: () => ({ type: 'inc' }),
              onError: () => ({ type: 'dec' }),
            },
          ],
        },
      ],
    }

    expect(() => replayTrace(Loader, trace)).not.toThrow()
  })

  it('still flags a real divergence in an effect carrying callbacks (data differs)', () => {
    type Eff = { type: 'http'; url: string; onSuccess: (data: unknown) => Msg }
    const Loader = component<State, Msg, Eff>({
      name: 'Loader2',
      init: () => [{ count: 0 }, []],
      update: (state, msg) =>
        msg.type === 'inc'
          ? [
              { count: state.count + 1 },
              [{ type: 'http', url: '/api/data', onSuccess: () => ({ type: 'inc' }) }],
            ]
          : [{ count: state.count - 1 }, []],
      view: () => [],
    })

    const trace: LluiTrace<State, Msg, Eff> = {
      lluiTrace: 1,
      component: 'Loader2',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        {
          msg: { type: 'inc' },
          expectedState: { count: 1 },
          expectedEffects: [
            { type: 'http', url: '/DIFFERENT', onSuccess: () => ({ type: 'inc' }) },
          ],
        },
      ],
    }

    expect(() => replayTrace(Loader, trace)).toThrow(/step 0/)
  })
})
