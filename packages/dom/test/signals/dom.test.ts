import { describe, it, expect } from 'vitest'
import { mountSignal, signalText, staticText, el, elNS, react } from '../../src/signals/dom'

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
    const m = mountSignal(
      container,
      { count: 1, user: { name: 'ab' }, busy: false } as State,
      () => [
        el('div', {}, [
          signalText((s) => (s as State).count, ['count']),
          signalText((s) => (s as State).user.name, ['user.name']),
        ]),
      ],
    )
    expect(container.textContent).toBe('1ab')

    // Text nodes are materialized into the DOM — grab them there (helpers return a
    // lazy Mountable, not the node).
    const div = container.firstChild as Element
    const beforeCount = div.childNodes[0] as Text
    const beforeName = div.childNodes[1] as Text
    m.update({ count: 2, user: { name: 'ab' }, busy: false } as State)

    expect(beforeCount.data).toBe('2') // updated
    expect(beforeName.data).toBe('ab') // unchanged
    expect(div.childNodes[0]).toBe(beforeCount) // same Text node — mutated, not recreated
    expect(div.childNodes[1]).toBe(beforeName)
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
    const m = mountSignal(
      container,
      { count: 0, user: { name: 'ab' }, busy: false } as State,
      // emulates state.at('user.name').map(n => `Hi, ${n}`) -> dep ['user.name']
      () => [el('p', {}, [signalText((s) => `Hi, ${(s as State).user.name}`, ['user.name'])])],
    )
    const greetNode = container.querySelector('p')!.firstChild as Text
    expect(greetNode.data).toBe('Hi, ab')
    m.update({ count: 0, user: { name: 'cd' }, busy: false } as State)
    expect(greetNode.data).toBe('Hi, cd')
    // a change to an unrelated path leaves it alone
    const before = greetNode.data
    m.update({ count: 9, user: { name: 'cd' }, busy: false } as State)
    expect(greetNode.data).toBe(before)
  })

  it('throws if a helper is materialized outside a build', () => {
    // Constructing a Mountable outside a build is fine (lazy); mounting it needs ctx.
    expect(() => signalText((s) => s, []).mount()).toThrow(/outside a signal build/)
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

// Bare string/number children coerce to text nodes — so `div(['hello'])` and
// `span([count])` work without an explicit `text(...)` wrapper, matching every
// mainstream framework. Both the authoring helpers and the compiler's emitted
// `el(tag, props, [children])` flow through this single chokepoint.
describe('signal DOM — string/number children coerce to text nodes', () => {
  it('coerces bare string and number children (mixed with real nodes)', () => {
    const container = document.createElement('div')
    mountSignal(container, {} as Record<string, never>, () => [
      el('div', {}, ['hello', 42, el('span', {}, ['x'])]),
    ])
    expect(container.textContent).toBe('hello42x')
  })

  it('coerces children inside an SVG (elNS) element too', () => {
    const container = document.createElement('div')
    mountSignal(container, {} as Record<string, never>, () => [elNS('text', {}, ['label'])])
    expect(container.textContent).toBe('label')
  })
})
