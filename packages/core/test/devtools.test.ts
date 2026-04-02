import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text } from '../src/index'
import type { LluiDebugAPI } from '../src/devtools'

declare const globalThis: { __lluiDebug?: LluiDebugAPI }

type State = { count: number }
type Msg = { type: 'inc' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ count: state.count + 1 }, []]
    }
  },
  view: () => [div({}, [text((s: State) => String(s.count))])],
  __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
})

describe('DevTools', () => {
  it('exposes __lluiDebug on globalThis when devTools option is set', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter, undefined, { devTools: true })

    expect(globalThis.__lluiDebug).toBeDefined()

    handle.dispose()
    delete globalThis.__lluiDebug
  })

  it('getState returns current state', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter, undefined, { devTools: true })

    expect(globalThis.__lluiDebug!.getState()).toEqual({ count: 0 })

    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()

    expect(globalThis.__lluiDebug!.getState()).toEqual({ count: 1 })

    handle.dispose()
    delete globalThis.__lluiDebug
  })

  it('evalUpdate dry-runs without modifying state', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter, undefined, { devTools: true })

    const result = globalThis.__lluiDebug!.evalUpdate({ type: 'inc' })
    expect(result.state).toEqual({ count: 1 })
    expect(result.effects).toEqual([])

    // State unchanged
    expect(globalThis.__lluiDebug!.getState()).toEqual({ count: 0 })

    handle.dispose()
    delete globalThis.__lluiDebug
  })

  it('records message history', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter, undefined, { devTools: true })

    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()
    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()

    const history = globalThis.__lluiDebug!.getMessageHistory()
    expect(history).toHaveLength(2)
    expect(history[0]!.stateAfter).toEqual({ count: 1 })
    expect(history[1]!.stateAfter).toEqual({ count: 2 })

    handle.dispose()
    delete globalThis.__lluiDebug
  })

  it('exportTrace produces valid LluiTrace format', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter, undefined, { devTools: true })

    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()

    const trace = globalThis.__lluiDebug!.exportTrace()
    expect(trace.lluiTrace).toBe(1)
    expect(trace.component).toBe('Counter')
    expect(trace.entries).toHaveLength(1)
    expect(trace.entries[0]!.expectedState).toEqual({ count: 1 })

    handle.dispose()
    delete globalThis.__lluiDebug
  })
})
