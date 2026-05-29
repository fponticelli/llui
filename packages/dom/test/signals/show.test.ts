import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, staticText, el, signalShow } from '../../src/signals/dom'

interface S {
  open: boolean
  name: string
}
type M = { type: 'toggle' } | { type: 'rename'; v: string }

function setup(initial: S) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => initial,
    update: (s, m) => (m.type === 'toggle' ? { ...s, open: !s.open } : { ...s, name: m.v }),
    view: () => [
      el('div', {}, [
        signalShow({ produce: (s) => (s as S).open, deps: ['open'] }, () => [
          el('p', {}, [signalText((s) => (s as S).name, ['name'])]),
        ]),
      ]),
    ],
  })
  const root = container.querySelector('div')!
  return { h, root }
}

describe('signalShow — conditional render', () => {
  it('renders content when initially true', () => {
    const { root } = setup({ open: true, name: 'ada' })
    expect(root.querySelector('p')?.textContent).toBe('ada')
  })

  it('renders nothing when initially false', () => {
    const { root } = setup({ open: false, name: 'ada' })
    expect(root.querySelector('p')).toBeNull()
  })

  it('mounts on false->true and unmounts on true->false', () => {
    const { h, root } = setup({ open: false, name: 'ada' })
    expect(root.querySelector('p')).toBeNull()
    h.send({ type: 'toggle' })
    expect(root.querySelector('p')?.textContent).toBe('ada')
    h.send({ type: 'toggle' })
    expect(root.querySelector('p')).toBeNull()
  })

  it('CRITICAL: shown content reacts to OTHER state while mounted', () => {
    // This is the child-scope propagation guarantee: content depends on `name`,
    // not on the `open` condition. Changing `name` while shown must update it.
    const { h, root } = setup({ open: true, name: 'ada' })
    const p = root.querySelector('p')!
    const textNode = p.firstChild as Text
    expect(textNode.data).toBe('ada')
    h.send({ type: 'rename', v: 'lin' }) // does NOT touch `open`
    expect(textNode.data).toBe('lin') // content updated in place
    expect(root.querySelector('p')).toBe(p) // same node, still mounted
  })

  it('content mounted on toggle picks up the current state', () => {
    const { h, root } = setup({ open: false, name: 'ada' })
    h.send({ type: 'rename', v: 'lin' }) // while hidden
    h.send({ type: 'toggle' }) // now show
    expect(root.querySelector('p')?.textContent).toBe('lin') // current value, not stale
  })

  it('re-mount after hide rebuilds fresh and current', () => {
    const { h, root } = setup({ open: true, name: 'ada' })
    h.send({ type: 'toggle' }) // hide
    h.send({ type: 'rename', v: 'zed' }) // change while hidden
    h.send({ type: 'toggle' }) // show again
    expect(root.querySelector('p')?.textContent).toBe('zed')
  })
})

describe('signalShow — else arm (binary)', () => {
  function setupElse(initial: S) {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => initial,
      update: (s, m) => (m.type === 'toggle' ? { ...s, open: !s.open } : { ...s, name: m.v }),
      view: () => [
        el('div', {}, [
          signalShow(
            { produce: (s) => (s as S).open, deps: ['open'] },
            () => [el('p', { id: 'then' }, [signalText((s) => (s as S).name, ['name'])])],
            () => [el('p', { id: 'else' }, [staticText('closed')])],
          ),
        ]),
      ],
    })
    return { h, root: container.querySelector('div')! }
  }

  it('mounts then-arm when truthy, else-arm when falsy, swapping on toggle', () => {
    const { h, root } = setupElse({ open: true, name: 'ada' })
    expect(root.querySelector('#then')?.textContent).toBe('ada')
    expect(root.querySelector('#else')).toBeNull()

    h.send({ type: 'toggle' }) // -> falsy: else arm
    expect(root.querySelector('#then')).toBeNull()
    expect(root.querySelector('#else')?.textContent).toBe('closed')

    h.send({ type: 'toggle' }) // -> truthy again: then arm, fresh
    expect(root.querySelector('#then')?.textContent).toBe('ada')
    expect(root.querySelector('#else')).toBeNull()
  })

  it('then-arm reacts to state while mounted; same-truthiness update does not swap', () => {
    const { h, root } = setupElse({ open: true, name: 'ada' })
    const thenEl = root.querySelector('#then')!
    h.send({ type: 'rename', v: 'lin' }) // open stays true
    expect(root.querySelector('#then')).toBe(thenEl) // not remounted
    expect(thenEl.textContent).toBe('lin') // inner binding updated
  })
})
