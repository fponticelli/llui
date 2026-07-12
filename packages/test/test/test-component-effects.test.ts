import { describe, it, expect } from 'vitest'
import { component, mountApp, div, text, type EffectApi } from '@llui/dom'
import { testComponent } from '../src/test-component'

// A component whose onEffect synchronously `send`s — the exact shape the audit
// flags: the pure-reducer harness stops after one update() and never runs the
// cascade, so its terminal state diverges from a real mount.
type State = { count: number; doubled: number; log: string[] }
type Msg = { type: 'inc' } | { type: 'recordDouble'; value: number }
type Effect = { type: 'double'; of: number } | { type: 'note'; text: string }

const Cascade = component<State, Msg, Effect>({
  name: 'Cascade',
  init: () => [{ count: 0, doubled: 0, log: [] }, [{ type: 'note', text: 'init' }]],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, [{ type: 'double', of: state.count + 1 }]]
      case 'recordDouble':
        return [{ ...state, doubled: msg.value }, []]
    }
  },
  view: ({ state }) => [div([text(state.map((s) => `count ${s.count}`))])],
  onEffect: (effect: Effect, api: EffectApi<State, Msg>) => {
    if (effect.type === 'double') {
      // Synchronous send back into the loop — this is the cascade.
      api.send({ type: 'recordDouble', value: effect.of * 2 })
    }
  },
})

describe('testComponent withEffects', () => {
  it('pure-reducer mode (default) does NOT run the cascade', () => {
    const t = testComponent(Cascade)
    t.send({ type: 'inc' })
    expect(t.state.count).toBe(1)
    // doubled stays 0 — the effect was recorded, never dispatched.
    expect(t.state.doubled).toBe(0)
    expect(t.effects).toEqual([{ type: 'double', of: 1 }])
  })

  it('withEffects runs the effect->send cascade to quiescence', () => {
    const t = testComponent(Cascade, { withEffects: true })
    t.send({ type: 'inc' })
    expect(t.state.count).toBe(1)
    // doubled is set by the effect-driven recordDouble send.
    expect(t.state.doubled).toBe(2)
  })

  it('reaches the SAME terminal state as a real mountApp', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Cascade)
    try {
      const msgs: Msg[] = [{ type: 'inc' }, { type: 'inc' }, { type: 'inc' }]
      for (const m of msgs) {
        handle.send(m)
        handle.flush()
      }
      const realState = handle.getState()

      const t = testComponent(Cascade, { withEffects: true })
      t.sendAll(msgs)

      expect(t.state).toEqual(realState)
      expect(t.state.doubled).toBe(6) // last inc: count 3 -> double 3 -> *2 = 6
    } finally {
      handle.dispose()
    }
  })

  it('dispatches init effects (and their cascades) in withEffects mode', () => {
    const t = testComponent(Cascade, { withEffects: true })
    // init emits a `note` effect; onEffect ignores notes, so state is unchanged
    // but the effect is recorded in allEffects.
    expect(t.allEffects).toContainEqual({ type: 'note', text: 'init' })
    expect(t.state).toEqual({ count: 0, doubled: 0, log: [] })
  })

  it('history records every reducer run in the cascade under one send', () => {
    const t = testComponent(Cascade, { withEffects: true })
    t.send({ type: 'inc' })
    // Two reducer runs: the inc, then the effect-driven recordDouble.
    expect(t.history.map((h) => h.msg.type)).toEqual(['inc', 'recordDouble'])
  })

  it('exposes the per-mount lifecycle signal to onEffect and aborts on dispose', () => {
    let captured: AbortSignal | null = null
    let cleaned = false
    const Probe = component<{ n: number }, { type: 'go' }, { type: 'fx' }>({
      name: 'Probe',
      init: () => [{ n: 0 }, []],
      update: (s) => [{ n: s.n + 1 }, [{ type: 'fx' }]],
      view: () => [],
      onEffect: (_e, api) => {
        captured = api.signal
        return () => {
          cleaned = true
        }
      },
    })
    const t = testComponent(Probe, { withEffects: true })
    t.send({ type: 'go' })
    expect(captured).toBeInstanceOf(AbortSignal)
    expect(captured!.aborted).toBe(false)
    t.dispose()
    expect(captured!.aborted).toBe(true)
    expect(cleaned).toBe(true)
    // After dispose, send is inert.
    const before = t.state.n
    t.send({ type: 'go' })
    expect(t.state.n).toBe(before)
  })

  it('batch coalesces a burst into one effects window, matching mountApp state', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Cascade)
    try {
      handle.batch(() => {
        handle.send({ type: 'inc' })
        handle.send({ type: 'inc' })
      })
      handle.flush()
      const realState = handle.getState()

      const t = testComponent(Cascade, { withEffects: true })
      t.batch(() => {
        t.send({ type: 'inc' })
        t.send({ type: 'inc' })
      })
      expect(t.state).toEqual(realState)
    } finally {
      handle.dispose()
    }
  })
})
