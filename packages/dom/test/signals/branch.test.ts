import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalBranch } from '../../src/signals/dom'

interface S {
  view: 'loading' | 'loaded' | 'error'
  title: string
  message: string
}
type M = { type: 'go'; view: S['view'] } | { type: 'setTitle'; v: string }

function setup(initial: S) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => initial,
    update: (s, m) => (m.type === 'go' ? { ...s, view: m.view } : { ...s, title: m.v }),
    view: () => [
      el('div', {}, [
        signalBranch(
          { produce: (s) => (s as S).view, deps: ['view'] },
          {
            loading: () => [el('span', { id: 'l' }, [signalText(() => 'Loading…', [])])],
            loaded: () => [el('span', { id: 'd' }, [signalText((s) => (s as S).title, ['title'])])],
            error: () => [
              el('span', { id: 'e' }, [signalText((s) => (s as S).message, ['message'])]),
            ],
          },
        ),
      ]),
    ],
  })
  return { h, root: container.querySelector('div')! }
}

describe('signalBranch — discriminated-union render', () => {
  it('mounts the matching arm', () => {
    const { root } = setup({ view: 'loading', title: 't', message: 'm' })
    expect(root.querySelector('#l')?.textContent).toBe('Loading…')
    expect(root.querySelector('#d')).toBeNull()
  })

  it('swaps arms on discriminant change', () => {
    const { h, root } = setup({ view: 'loading', title: 'hello', message: 'boom' })
    h.send({ type: 'go', view: 'loaded' })
    expect(root.querySelector('#l')).toBeNull()
    expect(root.querySelector('#d')?.textContent).toBe('hello')
    h.send({ type: 'go', view: 'error' })
    expect(root.querySelector('#d')).toBeNull()
    expect(root.querySelector('#e')?.textContent).toBe('boom')
  })

  it('CRITICAL: the mounted arm reacts to other state (child-scope propagation)', () => {
    const { h, root } = setup({ view: 'loaded', title: 'hello', message: 'm' })
    const span = root.querySelector('#d')!
    const textNode = span.firstChild as Text
    expect(textNode.data).toBe('hello')
    h.send({ type: 'setTitle', v: 'world' }) // does not change `view`
    expect(textNode.data).toBe('world')
    expect(root.querySelector('#d')).toBe(span) // same node, not remounted
  })

  it('same-value discriminant update does not remount the arm', () => {
    const { h, root } = setup({ view: 'loaded', title: 'a', message: 'm' })
    const span = root.querySelector('#d')!
    h.send({ type: 'go', view: 'loaded' }) // same view (no-op via reducer ref? new obj, same value)
    expect(root.querySelector('#d')).toBe(span) // not remounted
  })

  it('absent arm renders nothing', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<{ k: string }, { type: 'set'; k: string }>(container, {
      init: () => ({ k: 'a' }),
      update: (_s, m) => ({ k: m.k }),
      view: () => [
        el('div', {}, [
          signalBranch(
            { produce: (s) => (s as { k: string }).k, deps: ['k'] },
            {
              a: () => [el('span', { id: 'a' }, [])],
            },
          ),
        ]),
      ],
    })
    const root = container.querySelector('div')!
    expect(root.querySelector('#a')).not.toBeNull()
    h.send({ type: 'set', k: 'b' }) // no arm 'b'
    expect(root.querySelector('#a')).toBeNull()
    expect(root.querySelector('span')).toBeNull()
  })
})
