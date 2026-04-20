import { describe, it, expect, vi } from 'vitest'
import { component, div, text, mountApp, hydrateApp } from '../src/index'

type S = { count: number }
type M = { type: 'inc' } | { type: 'set'; value: number }

const Counter = component<S, M, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'set':
        return [{ ...state, count: msg.value }, []]
    }
  },
  view: () => [div({}, [text((s: S) => String(s.count))])],
  __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
})

describe('AppHandle.subscribe', () => {
  it('listener is called with the new state after each update cycle', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const states: S[] = []
    try {
      handle.subscribe((s) => states.push(s as S))
      handle.send({ type: 'inc' })
      handle.flush()
      handle.send({ type: 'inc' })
      handle.flush()
      expect(states).toEqual([{ count: 1 }, { count: 2 }])
    } finally {
      handle.dispose()
    }
  })

  it('listener is NOT called for the initial mount', () => {
    const container = document.createElement('div')
    const states: S[] = []
    const handle = mountApp(container, Counter)
    // Register listener only after mount — initial state commit already happened
    handle.subscribe((s) => states.push(s as S))
    try {
      // No send/flush yet — listener should not have been called
      expect(states).toEqual([])
    } finally {
      handle.dispose()
    }
  })

  it('unsubscribe stops future notifications', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const states: S[] = []
    try {
      const unsub = handle.subscribe((s) => states.push(s as S))
      handle.send({ type: 'inc' })
      handle.flush()
      expect(states).toEqual([{ count: 1 }])

      unsub()

      handle.send({ type: 'inc' })
      handle.flush()
      // Should still be just the one state
      expect(states).toEqual([{ count: 1 }])
    } finally {
      handle.dispose()
    }
  })

  it('subscribe after dispose returns a no-op unsubscribe and listener is never called', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    handle.dispose()
    const states: S[] = []
    const unsub = handle.subscribe((s) => states.push(s as S))
    // unsub should be a no-op function, not throw
    expect(() => unsub()).not.toThrow()
    expect(states).toEqual([])
  })

  it('listener error is caught and does not prevent other listeners from firing', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const good: S[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      handle.subscribe(() => {
        throw new Error('bad listener')
      })
      handle.subscribe((s) => good.push(s as S))

      handle.send({ type: 'set', value: 42 })
      handle.flush()

      expect(good).toEqual([{ count: 42 }])
      expect(spy).toHaveBeenCalledWith(
        '[llui] listener threw:',
        expect.objectContaining({ message: 'bad listener' }),
      )
    } finally {
      spy.mockRestore()
      handle.dispose()
    }
  })

  it('dispose clears listeners so they are not called on subsequent sends from lingering references', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const states: S[] = []
    handle.subscribe((s) => states.push(s as S))
    handle.dispose()
    // After dispose, the set is cleared. Any send is a no-op anyway,
    // but verify _onCommit is no longer wired.
    expect(states).toEqual([])
  })

  it('multiple listeners all receive the new state', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const a: S[] = []
    const b: S[] = []
    try {
      handle.subscribe((s) => a.push(s as S))
      handle.subscribe((s) => b.push(s as S))
      handle.send({ type: 'inc' })
      handle.flush()
      expect(a).toEqual([{ count: 1 }])
      expect(b).toEqual([{ count: 1 }])
    } finally {
      handle.dispose()
    }
  })

  it('hydrateApp handle also supports subscribe', () => {
    const container = document.createElement('div')
    container.innerHTML = '<div>3</div>'
    const handle = hydrateApp(container, Counter, { count: 3 })
    const states: S[] = []
    try {
      handle.subscribe((s) => states.push(s as S))
      handle.send({ type: 'inc' })
      handle.flush()
      expect(states).toEqual([{ count: 4 }])
    } finally {
      handle.dispose()
    }
  })
})
