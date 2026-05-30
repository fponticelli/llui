import { describe, it, expect } from 'vitest'
import { component, type SignalComponentDef } from '@llui/dom'
import { testComponent } from '../src/test-component'

type CounterState = { count: number }
type CounterMsg = { type: 'inc' } | { type: 'dec' }

const Counter = component<CounterState, CounterMsg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ count: state.count + 1 }, []]
      case 'dec':
        return [{ count: state.count - 1 }, []]
    }
  },
  view: () => [],
})

type GreetingState = { name: string; count: number }
type GreetingMsg = { type: 'tick' }

const Greeting = component<GreetingState, GreetingMsg, never>({
  name: 'Greeting',
  init: () => [{ name: 'Ada', count: 10 }, []],
  update: (state, _msg) => [{ ...state, count: state.count + 1 }, []],
  view: () => [],
})

describe('testComponent', () => {
  it('runs init and exposes initial state for components with no init data', () => {
    const t = testComponent(Counter)
    expect(t.state).toEqual({ count: 0 })
    expect(t.effects).toEqual([])
  })

  it('threads send/history correctly', () => {
    const t = testComponent(Counter)
    t.send({ type: 'inc' })
    t.send({ type: 'inc' })
    t.send({ type: 'dec' })
    expect(t.state).toEqual({ count: 1 })
    expect(t.history).toHaveLength(3)
    expect(t.history[0]?.prevState).toEqual({ count: 0 })
    expect(t.history[0]?.nextState).toEqual({ count: 1 })
  })

  it('exposes the init-seeded state', () => {
    const t = testComponent(Greeting)
    expect(t.state).toEqual({ name: 'Ada', count: 10 })
  })

  it('preserves the typed ComponentDef at the call site (no cast required)', () => {
    const def: SignalComponentDef<GreetingState, GreetingMsg, never> = Greeting
    const t = testComponent(def)
    expect(t.state.name).toBe('Ada')
  })
})
