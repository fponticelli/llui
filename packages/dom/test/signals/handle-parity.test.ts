import { describe, it, expect, vi } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el, signalText } from '../../src/signals/dom'
import { pathHandle, isSignalHandle } from '../../src/signals/handle'
import type { Signal } from '../../src/signals/types'
import { tagSend } from '../../src/binding-descriptors'

/** Evaluate a signal handle against a concrete state value (test-only). */
function read<T>(sig: Signal<T>, state: unknown): T {
  if (!isSignalHandle(sig)) throw new Error('expected a signal handle')
  return sig.produce(state) as T
}

// Parity surface the agent client (factory.ts) + HMR drive on the signal handle:
// subscribe, runReducer, getBindingDescriptors, swapUpdate, setOnBindingError.

interface S {
  count: number
}
type M = { type: 'inc' } | { type: 'noop' }

function counter(container: Element) {
  return mountSignalComponent<S, M>(container, {
    init: () => ({ count: 0 }),
    update: (s, m) => (m.type === 'inc' ? { count: s.count + 1 } : s),
    view: ({ send }) => [
      el('span', {}, [signalText((s) => (s as S).count, ['count'])]),
      el('button', { onClick: () => send({ type: 'inc' }) }, []),
    ],
  })
}

describe('SignalComponentHandle — agent/HMR parity', () => {
  it('subscribe fires after a state-changing update, not on no-ops', () => {
    const h = counter(document.createElement('div'))
    const seen: number[] = []
    const unsub = h.subscribe((s) => seen.push((s as S).count))
    h.send({ type: 'inc' }) // 0 -> 1
    h.send({ type: 'noop' }) // identity return -> no notification
    h.send({ type: 'inc' }) // 1 -> 2
    expect(seen).toEqual([1, 2])
    unsub()
    h.send({ type: 'inc' })
    expect(seen).toEqual([1, 2]) // unsubscribed
  })

  it('subscribe is a no-op after dispose', () => {
    const h = counter(document.createElement('div'))
    h.dispose()
    const listener = vi.fn()
    const unsub = h.subscribe(listener)
    h.send({ type: 'inc' })
    expect(listener).not.toHaveBeenCalled()
    expect(() => unsub()).not.toThrow()
  })

  it('runReducer returns [state, effects] without committing', () => {
    const container = document.createElement('div')
    const h = counter(container)
    const out = h.runReducer({ type: 'inc' })
    expect(out).toEqual({ state: { count: 1 }, effects: [] })
    // not committed: live state + DOM unchanged
    expect(h.getState().count).toBe(0)
    expect(container.querySelector('span')!.textContent).toBe('0')
  })

  it('swapUpdate replaces the reducer without rebuilding the DOM', () => {
    const container = document.createElement('div')
    const h = counter(container)
    const span = container.querySelector('span')!
    h.send({ type: 'inc' })
    expect(span.textContent).toBe('1')
    // swap to a reducer that doubles on inc
    h.swapUpdate((s, m) => ((m as M).type === 'inc' ? { count: (s as S).count + 10 } : (s as S)))
    h.send({ type: 'inc' })
    expect(span.textContent).toBe('11') // same node, new reducer
    expect(container.querySelector('span')).toBe(span)
  })

  it('setOnBindingError catches an accessor throw, keeps prior DOM, continues', () => {
    interface St {
      ok: boolean
    }
    const container = document.createElement('div')
    const errors: Array<{ kind: string; message: string }> = []
    const h = mountSignalComponent<St, { type: 'flip' }>(container, {
      init: () => ({ ok: true }),
      update: () => ({ ok: false }),
      view: () => [
        el('span', {}, [
          signalText(
            (s) => {
              if (!(s as St).ok) throw new Error('boom')
              return 'fine'
            },
            ['ok'],
          ),
        ]),
      ],
    })
    h.setOnBindingError((e) => errors.push({ kind: e.kind, message: e.message }))
    const span = container.querySelector('span')!
    expect(span.textContent).toBe('fine')
    h.send({ type: 'flip' }) // accessor throws on next produce
    expect(errors).toEqual([{ kind: 'binding', message: 'boom' }])
    expect(span.textContent).toBe('fine') // left at prior value, not blanked
  })

  it('getBindingDescriptors reflects live tagSend handlers', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ count: 0 }),
      update: (s) => s,
      view: ({ send }) => [
        el('button', { onClick: tagSend(send, ['Inc'], () => send({ type: 'inc' })) }, []),
      ],
    })
    expect(h.getBindingDescriptors()).toEqual([{ variant: 'Inc' }])
  })
})

describe('pathHandle — handle directly produces against state', () => {
  it('produce/map/at compose for handler-side reads', () => {
    const root = pathHandle<{ a: { b: number } }>(() => undefined, '')
    expect(read(root.at('a').at('b'), { a: { b: 7 } })).toBe(7)
    expect(
      read(
        root.map((s) => s.a.b * 2),
        { a: { b: 7 } },
      ),
    ).toBe(14)
  })
})
