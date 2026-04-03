import { describe, it, expect, vi } from 'vitest'
import { mountApp, component, text, div } from '../src/index'

describe('initial effects from init()', () => {
  it('dispatches effects returned from init()', async () => {
    const effectLog: string[] = []

    type State = { label: string }
    type Msg = { type: 'loaded'; payload: string }
    type Effect = { type: 'load' }

    const App = component<State, Msg, Effect>({
      name: 'InitEffect',
      init: () => [{ label: 'loading' }, [{ type: 'load' }]],
      update: (s, msg) => {
        if (msg.type === 'loaded') return [{ label: msg.payload }, []]
        return [s, []]
      },
      view: () => [div({}, [text((s: State) => s.label)])],
      onEffect: (effect, send) => {
        effectLog.push(effect.type)
        if (effect.type === 'load') {
          send({ type: 'loaded', payload: 'done' })
        }
      },
    })

    const container = document.createElement('div')
    mountApp(container, App)

    // onEffect should have been called synchronously during mountApp
    expect(effectLog).toContain('load')

    // The 'loaded' message was sent via send() — wait for microtask
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('done')
  })

  it('dispatches multiple initial effects in order', () => {
    const effectLog: string[] = []

    type Effect = { type: 'a' } | { type: 'b' } | { type: 'c' }

    const App = component<null, never, Effect>({
      name: 'MultiEffect',
      init: () => [null, [{ type: 'a' }, { type: 'b' }, { type: 'c' }]],
      update: (s) => [s, []],
      view: () => [text('')],
      onEffect: (effect) => { effectLog.push(effect.type) },
    })

    mountApp(document.createElement('div'), App)
    expect(effectLog).toEqual(['a', 'b', 'c'])
  })

  it('dispatches init effects that produce messages which update the view', async () => {
    type State = { items: string[] }
    type Msg = { type: 'dataLoaded'; payload: { items: string[] } }
    type Effect = { type: 'http'; url: string; onSuccess: string; onError: string }

    const App = component<State, Msg, Effect>({
      name: 'DataLoad',
      init: () => [
        { items: [] },
        [{ type: 'http', url: '/api/items', onSuccess: 'dataLoaded', onError: 'err' }],
      ],
      update: (s, msg) => {
        if (msg.type === 'dataLoaded') return [{ items: msg.payload.items }, []]
        return [s, []]
      },
      view: () => [text((s: State) => s.items.length > 0 ? s.items.join(',') : 'empty')],
      onEffect: (effect, send) => {
        // Simulate async API response
        if (effect.type === 'http') {
          setTimeout(() => send({ type: 'dataLoaded', payload: { items: ['a', 'b'] } } as Msg), 10)
        }
      },
    })

    const container = document.createElement('div')
    mountApp(container, App)

    expect(container.textContent).toBe('empty')

    // Wait for the simulated API response + microtask
    await new Promise((r) => setTimeout(r, 50))
    expect(container.textContent).toBe('a,b')
  })
})
