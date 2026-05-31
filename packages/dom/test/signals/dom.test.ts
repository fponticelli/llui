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

// Form-control value/checked are IDL properties, not content attributes:
// <textarea>/<select> have NO `value` content attribute, and a control's
// `checked`/`selected` content attribute is its *default* — not its live
// state. Setting them via setAttribute silently fails to move `.value` /
// `.checked`, so the runtime must assign the DOM property directly.
describe('signal DOM — form-control value/checked apply as DOM properties', () => {
  interface FS {
    text: string
    choice: string
    on: boolean
  }
  const seed: FS = { text: 'alpha', choice: 'b', on: true }

  it('sets a <textarea> reactive value as a live property (.value), and updates it', () => {
    const container = document.createElement('div')
    const m = mountSignal(container, { ...seed } as FS, () => [
      el('textarea', { value: react((s) => (s as FS).text, ['text']) }, []),
    ])
    const ta = container.firstChild as HTMLTextAreaElement
    expect(ta.value).toBe('alpha')
    m.update({ ...seed, text: 'beta' } as FS)
    expect(ta.value).toBe('beta')
  })

  it('sets a static <textarea> value as a live property', () => {
    const container = document.createElement('div')
    mountSignal(container, { ...seed } as FS, () => [el('textarea', { value: 'hello' }, [])])
    expect((container.firstChild as HTMLTextAreaElement).value).toBe('hello')
  })

  it('sets a <select> reactive value, selecting the matching option', () => {
    const container = document.createElement('div')
    const m = mountSignal(container, { ...seed } as FS, () => [
      el('select', { value: react((s) => (s as FS).choice, ['choice']) }, [
        el('option', { value: 'a' }, [staticText('A')]),
        el('option', { value: 'b' }, [staticText('B')]),
        el('option', { value: 'c' }, [staticText('C')]),
      ]),
    ])
    const sel = container.firstChild as HTMLSelectElement
    expect(sel.value).toBe('b')
    m.update({ ...seed, choice: 'c' } as FS)
    expect(sel.value).toBe('c')
  })

  it('sets a checkbox reactive `checked` as a live property, and updates it', () => {
    const container = document.createElement('div')
    const m = mountSignal(container, { ...seed } as FS, () => [
      el('input', { type: 'checkbox', checked: react((s) => (s as FS).on, ['on']) }, []),
    ])
    const box = container.firstChild as HTMLInputElement
    expect(box.checked).toBe(true)
    m.update({ ...seed, on: false } as FS)
    expect(box.checked).toBe(false)
  })

  it('keeps <input> value working (regression) and clears on null', () => {
    const container = document.createElement('div')
    const m = mountSignal(container, { ...seed } as FS, () => [
      el('input', { value: react((s) => (s as FS).text, ['text']) }, []),
    ])
    const inp = container.firstChild as HTMLInputElement
    expect(inp.value).toBe('alpha')
    m.update({ ...seed, text: '' } as FS)
    expect(inp.value).toBe('')
  })

  it('leaves a `value` attribute on a non-form element as an attribute', () => {
    const container = document.createElement('div')
    mountSignal(container, { ...seed } as FS, () => [el('div', { value: 'data-ish' }, [])])
    const div = container.firstChild as HTMLElement
    expect(div.getAttribute('value')).toBe('data-ish')
  })
})
