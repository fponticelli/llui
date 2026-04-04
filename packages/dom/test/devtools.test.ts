import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text } from '../src/index'
import { installDevTools } from '../src/devtools'
import type { LluiDebugAPI } from '../src/devtools'
import { createComponentInstance, flushInstance } from '../src/update-loop'
import { setFlatBindings } from '../src/binding'
import { setRenderContext, clearRenderContext } from '../src/render-context'

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

function mountWithDevTools() {
  const container = document.createElement('div')
  const inst = createComponentInstance(Counter)
  installDevTools(inst)

  setFlatBindings(inst.allBindings)
  setRenderContext({ rootScope: inst.rootScope, state: inst.state, allBindings: inst.allBindings, structuralBlocks: inst.structuralBlocks, container, send: inst.send })
  Counter.view(inst.state, inst.send)
  clearRenderContext()
  setFlatBindings(null)

  return { inst, container }
}

describe('DevTools', () => {
  it('exposes __lluiDebug on globalThis', () => {
    const { inst } = mountWithDevTools()
    expect(globalThis.__lluiDebug).toBeDefined()
    delete globalThis.__lluiDebug
  })

  it('getState returns current state', () => {
    mountWithDevTools()

    expect(globalThis.__lluiDebug!.getState()).toEqual({ count: 0 })

    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()

    expect(globalThis.__lluiDebug!.getState()).toEqual({ count: 1 })

    delete globalThis.__lluiDebug
  })

  it('evalUpdate dry-runs without modifying state', () => {
    mountWithDevTools()

    const result = globalThis.__lluiDebug!.evalUpdate({ type: 'inc' })
    expect(result.state).toEqual({ count: 1 })
    expect(result.effects).toEqual([])

    expect(globalThis.__lluiDebug!.getState()).toEqual({ count: 0 })

    delete globalThis.__lluiDebug
  })

  it('records message history', () => {
    mountWithDevTools()

    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()
    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()

    const history = globalThis.__lluiDebug!.getMessageHistory()
    expect(history).toHaveLength(2)
    expect(history[0]!.stateAfter).toEqual({ count: 1 })
    expect(history[1]!.stateAfter).toEqual({ count: 2 })

    delete globalThis.__lluiDebug
  })

  it('exportTrace produces valid LluiTrace format', () => {
    mountWithDevTools()

    globalThis.__lluiDebug!.send({ type: 'inc' })
    globalThis.__lluiDebug!.flush()

    const trace = globalThis.__lluiDebug!.exportTrace()
    expect(trace.lluiTrace).toBe(1)
    expect(trace.component).toBe('Counter')
    expect(trace.entries).toHaveLength(1)
    expect(trace.entries[0]!.expectedState).toEqual({ count: 1 })

    delete globalThis.__lluiDebug
  })
})
