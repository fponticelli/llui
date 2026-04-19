import { describe, it, expect } from 'vitest'
import { component, div, text, mountApp, hydrateApp, sample } from '../src/index'

type S = { count: number; label: string }
type M = { type: 'inc' } | { type: 'setLabel'; v: string }

const Counter = component<S, M, never>({
  name: 'Counter',
  init: () => [{ count: 0, label: 'x' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'setLabel':
        return [{ ...state, label: msg.v }, []]
    }
  },
  view: () => [div({ class: 'c' }, [text((s: S) => String(s.count))])],
  __dirty: (o, n) =>
    (Object.is(o.count, n.count) ? 0 : 0b01) | (Object.is(o.label, n.label) ? 0 : 0b10),
})

describe('AppHandle.getState — sanctioned escape hatch for reading state outside view', () => {
  it('mountApp returns a handle whose getState reflects the initial state', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    try {
      expect(handle.getState()).toEqual({ count: 0, label: 'x' })
    } finally {
      handle.dispose()
    }
  })

  it('getState reflects state changes after send + flush', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    try {
      handle.send({ type: 'inc' })
      handle.flush()
      expect(handle.getState()).toEqual({ count: 1, label: 'x' })

      handle.send({ type: 'setLabel', v: 'hello' })
      handle.flush()
      expect(handle.getState()).toEqual({ count: 1, label: 'hello' })
    } finally {
      handle.dispose()
    }
  })

  it('getState works from inside event handlers and async callbacks', async () => {
    // Reproduces the reported use case: an adapter wraps `send` to
    // consult current state before forwarding. Previously this required
    // reaching for h.sample inside the send wrapper, which throws
    // because the render context is cleared by the time the callback
    // fires. getState is the sanctioned replacement.
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    let observedFromCallback: S | null = null
    try {
      handle.send({ type: 'inc' })
      handle.flush()
      // Simulate an event handler or adapter send wrapper that needs to
      // read state without being inside view().
      await Promise.resolve().then(() => {
        observedFromCallback = handle.getState() as S
      })
      expect(observedFromCallback).toEqual({ count: 1, label: 'x' })
    } finally {
      handle.dispose()
    }
  })

  it('getState throws after dispose so stale reads fail loud', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    handle.dispose()
    expect(() => handle.getState()).toThrow(/disposed/i)
  })

  it('hydrateApp returns a handle with getState', () => {
    const container = document.createElement('div')
    container.innerHTML = '<div class="c">5</div>'
    const handle = hydrateApp(container, Counter, { count: 5, label: 'h' })
    try {
      expect(handle.getState()).toEqual({ count: 5, label: 'h' })
    } finally {
      handle.dispose()
    }
  })
})

describe('sample — error message points at AppHandle.getState', () => {
  it('calling sample outside a view throws with migration guidance', () => {
    // Setting up without ever entering a render context — sample
    // immediately throws. The error text should mention the idiom
    // (AppHandle.getState) so users reading the stack trace see the
    // fix without having to dig into the library source.
    expect(() => sample<{ x: number }, number>((s) => s.x)).toThrow(/getState/i)
  })

  it('the thrown error specifically mentions handler/callback context', () => {
    try {
      sample<{ x: number }, number>((s) => s.x)
      expect.fail('sample should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toMatch(/handler|callback|render context/i)
      expect(msg).toMatch(/getState/i)
    }
  })
})
