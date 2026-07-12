import { describe, it, expect, vi, afterEach } from 'vitest'
import { pathHandle, type Signal } from '@llui/dom'
import * as tabs from '../../src/components/tabs'
import * as radioGroup from '../../src/components/radio-group'
import * as toggleGroup from '../../src/components/toggle-group'
import * as treeView from '../../src/components/tree-view'
import * as accordion from '../../src/components/accordion'
import * as pinInput from '../../src/components/pin-input'

/**
 * Finding 1 — roving-tabindex widgets must move REAL DOM focus on arrow keys,
 * not just update state. AT follows document.activeElement, so these tests
 * assert focus lands on the newly-active element.
 */

afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * A signal whose value is a mutable holder — `peek()`/`map()` reflect the
 * latest value after a `send` reassigns it. Returns the signal plus a setter
 * used to build a synchronous `send`.
 */
function mutable<S>(initial: S): { signal: Signal<S>; set: (s: S) => void } {
  const holder = { current: initial }
  return { signal: pathHandle<S>(() => holder.current, ''), set: (s) => (holder.current = s) }
}

/** Dispatch a keydown to a handler with a real currentTarget element. */
function key(el: HTMLElement, k: string, handler: (e: KeyboardEvent) => void): void {
  const ev = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true })
  Object.defineProperty(ev, 'currentTarget', { value: el, configurable: true })
  handler(ev)
}

describe('roving focus moves document.activeElement', () => {
  it('tabs: ArrowRight focuses the next trigger', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-scope="tabs" data-part="root">
        <div data-scope="tabs" data-part="list">
          <button data-scope="tabs" data-part="trigger" data-value="a">A</button>
          <button data-scope="tabs" data-part="trigger" data-value="b">B</button>
        </div>
      </div>`
    document.body.appendChild(root)
    const { signal, set } = mutable(tabs.init({ items: ['a', 'b'] }))
    const send = (m: tabs.TabsMsg): void => set(tabs.update(signal.peek(), m)[0])
    const parts = tabs.connect(signal, send, { id: 't' })
    const a = root.querySelector<HTMLElement>('[data-value="a"]')!
    a.focus()
    key(a, 'ArrowRight', parts.item('a').trigger.onKeyDown)
    expect(document.activeElement).toBe(root.querySelector('[data-value="b"]'))
  })

  it('radio-group: ArrowDown (vertical) focuses next radio', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-scope="radio-group" data-part="root" data-orientation="vertical">
        <div role="radio" data-scope="radio-group" data-part="item" data-value="a" tabindex="0">A</div>
        <div role="radio" data-scope="radio-group" data-part="item" data-value="b" tabindex="-1">B</div>
      </div>`
    document.body.appendChild(root)
    const { signal, set } = mutable(
      radioGroup.init({ items: ['a', 'b'], orientation: 'vertical', value: 'a' }),
    )
    const send = (m: radioGroup.RadioGroupMsg): void => set(radioGroup.update(signal.peek(), m)[0])
    const parts = radioGroup.connect(signal, send, { id: 'r' })
    const a = root.querySelector<HTMLElement>('[data-value="a"]')!
    a.focus()
    key(a, 'ArrowDown', parts.item('a').root.onKeyDown)
    expect(document.activeElement).toBe(root.querySelector('[data-value="b"]'))
  })

  it('toggle-group: ArrowRight focuses next item', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-scope="toggle-group" data-part="root" data-orientation="horizontal">
        <button data-scope="toggle-group" data-part="item" data-value="a">A</button>
        <button data-scope="toggle-group" data-part="item" data-value="b">B</button>
      </div>`
    document.body.appendChild(root)
    const { signal, set } = mutable(toggleGroup.init({ items: ['a', 'b'] }))
    const send = (m: toggleGroup.ToggleGroupMsg): void =>
      set(toggleGroup.update(signal.peek(), m)[0])
    const parts = toggleGroup.connect(signal, send)
    const a = root.querySelector<HTMLElement>('[data-value="a"]')!
    a.focus()
    key(a, 'ArrowRight', parts.item('a').root.onKeyDown)
    expect(document.activeElement).toBe(root.querySelector('[data-value="b"]'))
  })

  it('accordion: ArrowDown focuses next trigger', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-scope="accordion" data-part="root">
        <button data-scope="accordion" data-part="trigger" data-value="a">A</button>
        <button data-scope="accordion" data-part="trigger" data-value="b">B</button>
      </div>`
    document.body.appendChild(root)
    const { signal } = mutable(accordion.init({ items: ['a', 'b'] }))
    const parts = accordion.connect(signal, vi.fn(), { id: 'ac' })
    const a = root.querySelector<HTMLElement>('[data-value="a"]')!
    a.focus()
    key(a, 'ArrowDown', parts.item('a').trigger.onKeyDown)
    expect(document.activeElement).toBe(root.querySelector('[data-value="b"]'))
  })

  it('tree-view: ArrowDown focuses next visible item', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-scope="tree-view" data-part="root">
        <div role="treeitem" data-scope="tree-view" data-part="item" data-value="a" tabindex="0">A</div>
        <div role="treeitem" data-scope="tree-view" data-part="item" data-value="b" tabindex="-1">B</div>
      </div>`
    document.body.appendChild(root)
    const { signal, set } = mutable(treeView.init({ visibleItems: ['a', 'b'] }))
    const send = (m: treeView.TreeViewMsg): void => set(treeView.update(signal.peek(), m)[0])
    send({ type: 'focus', id: 'a' })
    const parts = treeView.connect(signal, send, { id: 'tv' })
    const a = root.querySelector<HTMLElement>('[data-value="a"]')!
    a.focus()
    key(a, 'ArrowDown', parts.item('a', 0, false).item.onKeyDown)
    expect(document.activeElement).toBe(root.querySelector('[data-value="b"]'))
  })

  it('pin-input: typing auto-advances DOM focus to the next field', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-scope="pin-input" data-part="root">
        <input data-scope="pin-input" data-part="input" data-index="0" />
        <input data-scope="pin-input" data-part="input" data-index="1" />
      </div>`
    document.body.appendChild(root)
    const { signal, set } = mutable(pinInput.init({ length: 2 }))
    const send = (m: pinInput.PinInputMsg): void => set(pinInput.update(signal.peek(), m)[0])
    const parts = pinInput.connect(signal, send, { id: 'p' })
    const first = root.querySelector<HTMLInputElement>('[data-index="0"]')!
    first.focus()
    first.value = '1'
    const ev = new Event('input', { bubbles: true })
    Object.defineProperty(ev, 'currentTarget', { value: first, configurable: true })
    Object.defineProperty(ev, 'target', { value: first, configurable: true })
    parts.input(0).onInput(ev)
    expect(document.activeElement).toBe(root.querySelector('[data-index="1"]'))
  })
})
