import { describe, it, expect, vi } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el } from '../../src/signals/dom'

describe('signal component — effects (effects-as-data)', () => {
  interface S {
    count: number
    log: string[]
  }
  type E = { type: 'record'; value: number }
  type M = { type: 'inc' } | { type: 'logged'; value: number }

  it('dispatches effects from update to onEffect; effect can send back', () => {
    const seen: number[] = []
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M, E>(container, {
      init: () => ({ count: 0, log: [] }),
      update: (s, m) => {
        if (m.type === 'inc')
          return [{ ...s, count: s.count + 1 }, [{ type: 'record', value: s.count + 1 }]]
        return [{ ...s, log: [...s.log, String(m.value)] }, []]
      },
      onEffect: (e, api) => {
        if (e.type === 'record') {
          seen.push(e.value)
          api.send({ type: 'logged', value: e.value }) // effect -> send -> update
        }
      },
      view: () => [el('span', {}, [signalText((s) => (s as S).count, ['count'])])],
    })

    h.send({ type: 'inc' })
    h.send({ type: 'inc' })
    expect(seen).toEqual([1, 2]) // effects ran
    expect(h.getState().log).toEqual(['1', '2']) // effect's send updated state
    expect(container.querySelector('span')!.textContent).toBe('2')
  })

  it('runs initial effects from init', () => {
    const fx = vi.fn()
    mountSignalComponent<{ n: number }, { type: 'x' }, { type: 'boot' }>(
      document.createElement('div'),
      {
        init: () => [{ n: 0 }, [{ type: 'boot' }]],
        update: (s) => [s, []],
        onEffect: (e) => fx(e.type),
        view: () => [],
      },
    )
    expect(fx).toHaveBeenCalledWith('boot')
  })

  it('warns in dev when an effect is emitted but no onEffect is registered', () => {
    // Silent-drop footgun: returning an effect with no handler used to no-op
    // silently. In dev the runtime now warns so it is visible.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = mountSignalComponent<{ n: number }, { type: 'go' }, { type: 'fx' }>(
      document.createElement('div'),
      {
        name: 'NoHandler',
        init: () => ({ n: 0 }),
        update: (s) => [s, [{ type: 'fx' }]],
        // no onEffect
        view: () => [],
      },
    )
    h.send({ type: 'go' })
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('no onEffect'))).toBe(true)
    warnSpy.mockRestore()
    h.dispose()
  })

  it('does not warn when an onEffect handler IS registered', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = mountSignalComponent<{ n: number }, { type: 'go' }, { type: 'fx' }>(
      document.createElement('div'),
      {
        init: () => ({ n: 0 }),
        update: (s) => [s, [{ type: 'fx' }]],
        onEffect: () => {},
        view: () => [],
      },
    )
    h.send({ type: 'go' })
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('no onEffect'))).toBe(false)
    warnSpy.mockRestore()
    h.dispose()
  })

  it('collects and runs effect cleanups on dispose', () => {
    const cleanup = vi.fn()
    const h = mountSignalComponent<{ n: number }, { type: 'sub' }, { type: 'listen' }>(
      document.createElement('div'),
      {
        init: () => ({ n: 0 }),
        update: (s) => [s, [{ type: 'listen' }]],
        onEffect: () => cleanup, // returns a cleanup
        view: () => [],
      },
    )
    h.send({ type: 'sub' })
    expect(cleanup).not.toHaveBeenCalled()
    h.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})

describe('signal component — handler reads current state via the bag handle (peek)', () => {
  interface S {
    draft: string
    saved: string[]
  }
  type M = { type: 'edit'; v: string } | { type: 'save'; v: string }

  it('a handler reads state.at(path).peek() at click time', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ draft: '', saved: [] }),
      update: (s, m) =>
        m.type === 'edit' ? { ...s, draft: m.v } : { ...s, saved: [...s.saved, m.v], draft: '' },
      // handler reads the CURRENT draft via the bag's state handle (peek)
      view: ({ state, send }) => [
        el(
          'button',
          { onClick: () => send({ type: 'save', v: state.at('draft').peek() as string }) },
          [],
        ),
      ],
    })

    h.send({ type: 'edit', v: 'hello' }) // state.draft = 'hello'
    const btn = container.querySelector('button')!
    btn.dispatchEvent(new MouseEvent('click')) // handler reads current draft
    expect(h.getState().saved).toEqual(['hello'])

    h.send({ type: 'edit', v: 'world' })
    btn.dispatchEvent(new MouseEvent('click'))
    expect(h.getState().saved).toEqual(['hello', 'world']) // read the NEW current value
  })

  it('state.peek() returns the whole current state', () => {
    const h = mountSignalComponent<{ a: number; b: number }, { type: 'x' }>(
      document.createElement('div'),
      {
        init: () => ({ a: 1, b: 2 }),
        update: (s) => ({ ...s, a: s.a + 1 }),
        view: ({ state, send }) =>
          [
            el('button', { onClick: () => void state.peek() }, []),
            el('span', {}, [signalText((s) => (s as { a: number }).a, ['a'])]),
          ].concat([el('i', { onClick: () => send({ type: 'x' }) }, [])]),
      },
    )
    h.send({ type: 'x' })
    expect(h.getState().a).toBe(2)
  })
})
