import { describe, it, expect } from 'vitest'
import { replayTrace, type LluiTrace } from '../src/replay-trace'
import { component } from '@llui/core'

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
})
