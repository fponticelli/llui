import { describe, it, expect } from 'vitest'
import { component, type ComponentDef } from '@llui/dom'
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
type GreetingData = { initialName: string; startAt: number }

const Greeting = component<GreetingState, GreetingMsg, never, GreetingData>({
  name: 'Greeting',
  init: (data) => [{ name: data.initialName, count: data.startAt }, []],
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

  it('forwards typed initial data to init(data) without requiring a cast', () => {
    const t = testComponent(Greeting, { initialName: 'Ada', startAt: 10 })
    expect(t.state).toEqual({ name: 'Ada', count: 10 })
  })

  it('preserves the D generic at the call site (no cast required)', () => {
    // Without a D generic on testComponent, assigning a typed ComponentDef
    // would require `as unknown as ComponentDef<S, M, E>` at the call site.
    const def: ComponentDef<GreetingState, GreetingMsg, never, GreetingData> = Greeting
    const t = testComponent(def, { initialName: 'Grace', startAt: 0 })
    expect(t.state.name).toBe('Grace')
  })
})
