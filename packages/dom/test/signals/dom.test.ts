import { describe, it, expect } from 'vitest'
import { mountSignal, signalText, staticText, el, react } from '../../src/signals/dom'

interface State {
  count: number
  user: { name: string }
  busy: boolean
}

describe('signal DOM — end-to-end reactive rendering (no VDOM, in-place update)', () => {
  it('mounts initial state into real DOM', () => {
    const container = document.createElement('div')
    mountSignal(container, { count: 1, user: { name: 'ab' }, busy: false } as State, () => [
      el('span', {}, [signalText((s) => (s as State).count, ['count'])]),
      el('span', {}, [signalText((s) => (s as State).user.name, ['user.name'])]),
    ])
    expect(container.textContent).toBe('1ab')
  })

  it('updates only changed bindings, in place (same node identity)', () => {
    const container = document.createElement('div')
    let countNode!: Text
    let nameNode!: Text
    const m = mountSignal(
      container,
      { count: 1, user: { name: 'ab' }, busy: false } as State,
      () => {
        countNode = signalText((s) => (s as State).count, ['count'])
        nameNode = signalText((s) => (s as State).user.name, ['user.name'])
        return [el('div', {}, [countNode, nameNode])]
      },
    )
    expect(container.textContent).toBe('1ab')

    const beforeCount = countNode
    const beforeName = nameNode
    m.update({ count: 2, user: { name: 'ab' }, busy: false } as State)

    expect(countNode.data).toBe('2') // updated
    expect(nameNode.data).toBe('ab') // unchanged
    expect(countNode).toBe(beforeCount) // same Text node — mutated, not recreated
    expect(nameNode).toBe(beforeName)
    expect(container.textContent).toBe('2ab')
  })

  it('reactive attributes update', () => {
    const container = document.createElement('div')
    const m = mountSignal(container, { count: 0, user: { name: '' }, busy: false } as State, () => [
      el('div', { class: react((s) => ((s as State).busy ? 'spin' : 'idle'), ['busy']) }, [
        staticText('x'),
      ]),
    ])
    const div = container.firstChild as Element
    expect(div.getAttribute('class')).toBe('idle')

    m.update({ count: 0, user: { name: '' }, busy: true } as State)
    expect(div.getAttribute('class')).toBe('spin')
  })

  it('reactive attribute removed when value is false/null', () => {
    const container = document.createElement('div')
    const m = mountSignal(container, { count: 0, user: { name: '' }, busy: true } as State, () => [
      el('button', { disabled: react((s) => (s as State).busy, ['busy']) }, []),
    ])
    const btn = container.firstChild as Element
    expect(btn.hasAttribute('disabled')).toBe(true)
    m.update({ count: 0, user: { name: '' }, busy: false } as State)
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('a derived binding (map-style produce) updates from its source path', () => {
    const container = document.createElement('div')
    let greetNode!: Text
    const m = mountSignal(
      container,
      { count: 0, user: { name: 'ab' }, busy: false } as State,
      () => {
        // emulates state.at('user.name').map(n => `Hi, ${n}`) -> dep ['user.name']
        greetNode = signalText((s) => `Hi, ${(s as State).user.name}`, ['user.name'])
        return [el('p', {}, [greetNode])]
      },
    )
    expect(greetNode.data).toBe('Hi, ab')
    m.update({ count: 0, user: { name: 'cd' }, busy: false } as State)
    expect(greetNode.data).toBe('Hi, cd')
    // a change to an unrelated path leaves it alone
    const before = greetNode.data
    m.update({ count: 9, user: { name: 'cd' }, busy: false } as State)
    expect(greetNode.data).toBe(before)
  })

  it('throws if a helper is used outside a build', () => {
    expect(() => signalText((s) => s, [])).toThrow(/outside a signal build/)
  })
})
