import { describe, expect, it } from 'vitest'
import { createTeaDriver, type TeaEffectApi, type TeaTransition } from '../../src/index'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'set'; value: number }
type Effect = { type: 'set'; value: number }

describe('createTeaDriver', () => {
  it('applies sends synchronously and commits a batch once at its settled state', () => {
    const commits: number[] = []
    const transitions: Array<TeaTransition<State, Msg, Effect>> = []
    const driver = createTeaDriver<State, Msg, Effect>(
      {
        init: () => [{ count: 0 }, []],
        update: (state, msg) => [
          msg.type === 'inc' ? { count: state.count + 1 } : { count: msg.value },
          [],
        ],
      },
      {
        onStateChange: (state) => commits.push(state.count),
        onTransition: (transition) => transitions.push(transition),
      },
    )

    driver.send({ type: 'inc' })
    expect(driver.getState()).toEqual({ count: 1 })

    driver.batch(() => {
      driver.send({ type: 'inc' })
      driver.send({ type: 'inc' })
      expect(driver.getState()).toEqual({ count: 3 })
    })

    expect(commits).toEqual([1, 3])
    expect(
      transitions.map(({ previousState, state }) => [previousState.count, state.count]),
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ])
  })

  it('queues effect-driven sends and drains them after the originating transition', () => {
    const trace: string[] = []
    const driver = createTeaDriver<State, Msg, Effect>(
      {
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          trace.push(`update:${msg.type}:${state.count}`)
          if (msg.type === 'inc') {
            return [{ count: state.count + 1 }, [{ type: 'set', value: 10 }]]
          }
          return [{ count: msg.value }, []]
        },
        onEffect: (effect, { send }) => {
          trace.push(`effect:${effect.type}`)
          send({ type: 'set', value: effect.value })
        },
      },
      { onStateChange: (state) => trace.push(`commit:${state.count}`) },
    )

    driver.send({ type: 'inc' })

    expect(driver.getState()).toEqual({ count: 10 })
    expect(trace).toEqual(['update:inc:0', 'commit:1', 'effect:set', 'update:set:1', 'commit:10'])
  })

  it('keeps reducer state but drops the round effects when a transition observer throws', () => {
    const effects: Effect[] = []
    const driver = createTeaDriver<State, Msg, Effect>(
      {
        init: () => [{ count: 0 }, []],
        update: (state) => [{ count: state.count + 1 }, [{ type: 'set', value: 9 }]],
        onEffect: (effect) => void effects.push(effect),
      },
      {
        onTransition: () => {
          throw new Error('observer failed')
        },
      },
    )

    expect(() => driver.send({ type: 'inc' })).toThrow('observer failed')
    expect(driver.getState()).toEqual({ count: 1 })
    expect(effects).toEqual([])
  })

  it('aborts the effect API and makes retained dispatch capabilities inert on dispose', () => {
    let effectApi: TeaEffectApi<State, Msg> | undefined
    let batchRan = false
    const driver = createTeaDriver<State, Msg, Effect>({
      init: () => [{ count: 0 }, [{ type: 'set', value: 1 }]],
      update: (state) => [{ count: state.count + 1 }, []],
      onEffect: (_effect, api) => {
        effectApi = api
      },
    })

    driver.dispose()
    effectApi!.send({ type: 'inc' })
    effectApi!.batch(() => {
      batchRan = true
    })

    expect(effectApi!.signal.aborted).toBe(true)
    expect(driver.getState()).toEqual({ count: 0 })
    expect(batchRan).toBe(false)
  })
})
