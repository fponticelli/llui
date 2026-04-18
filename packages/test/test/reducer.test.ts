import { describe, it, expect } from 'vitest'
import { reducer } from '../src/reducer'
import { testComponent } from '../src/test-component'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'add'; by: number }

describe('reducer()', () => {
  it('builds a ComponentDef usable by testComponent without a sham view', () => {
    const Counter = reducer<State, Msg>({
      init: () => [{ count: 0 }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'inc':
            return [{ count: s.count + 1 }, []]
          case 'add':
            return [{ count: s.count + m.by }, []]
        }
      },
    })

    const t = testComponent(Counter)
    t.send({ type: 'inc' })
    t.send({ type: 'add', by: 3 })
    expect(t.state.count).toBe(4)
  })

  it('threads typed init data', () => {
    type D = { startAt: number }
    const Counter = reducer<State, Msg, never, D>({
      init: (data) => [{ count: data.startAt }, []],
      update: (s, m) => (m.type === 'inc' ? [{ count: s.count + 1 }, []] : [s, []]),
    })

    const t = testComponent(Counter, { startAt: 10 })
    t.send({ type: 'inc' })
    expect(t.state.count).toBe(11)
  })

  it('uses the supplied name when provided', () => {
    const r = reducer<State, Msg>({
      name: 'MyReducer',
      init: () => [{ count: 0 }, []],
      update: (s) => [s, []],
    })
    expect(r.name).toBe('MyReducer')
  })

  it('defaults name to __reducer__ for leak detection', () => {
    const r = reducer<State, Msg>({
      init: () => [{ count: 0 }, []],
      update: (s) => [s, []],
    })
    expect(r.name).toBe('__reducer__')
  })

  it('forwards effects from update() into the harness', () => {
    type Effect = { type: 'log'; message: string }
    const R = reducer<State, Msg, Effect>({
      init: () => [{ count: 0 }, []],
      update: (s, m) =>
        m.type === 'inc' ? [{ count: s.count + 1 }, [{ type: 'log', message: 'inc' }]] : [s, []],
    })
    const t = testComponent(R)
    t.send({ type: 'inc' })
    expect(t.effects).toEqual([{ type: 'log', message: 'inc' }])
  })
})
