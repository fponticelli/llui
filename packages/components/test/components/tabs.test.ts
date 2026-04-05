import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, watchTabIndicator } from '../../src/components/tabs'

type Ctx = { tabs: ReturnType<typeof init> }
const wrap = (t: ReturnType<typeof init>): Ctx => ({ tabs: t })

describe('tabs reducer', () => {
  it('init picks first item as default value', () => {
    const s = init({ items: ['a', 'b', 'c'] })
    expect(s.value).toBe('a')
  })

  it('init respects explicit value', () => {
    const s = init({ items: ['a', 'b', 'c'], value: 'b' })
    expect(s.value).toBe('b')
  })

  it('setValue changes current tab', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'setValue', value: 'b' })
    expect(s.value).toBe('b')
  })

  it('setValue is ignored for disabled items', () => {
    const [s] = update(init({ items: ['a', 'b'], disabledItems: ['b'] }), {
      type: 'setValue',
      value: 'b',
    })
    expect(s.value).toBe('a')
  })

  it('focusNext wraps and skips disabled (automatic)', () => {
    const s0 = init({ items: ['a', 'b', 'c'], disabledItems: ['b'] })
    const [s1] = update(s0, { type: 'focusNext', from: 'a' })
    expect(s1.focused).toBe('c')
    expect(s1.value).toBe('c') // automatic activation
  })

  it('focusPrev wraps backwards', () => {
    const s0 = init({ items: ['a', 'b', 'c'] })
    const [s1] = update(s0, { type: 'focusPrev', from: 'a' })
    expect(s1.focused).toBe('c')
  })

  it('manual activation: focusNext moves focus without activating', () => {
    const s0 = init({ items: ['a', 'b', 'c'], activation: 'manual' })
    const [s1] = update(s0, { type: 'focusNext', from: 'a' })
    expect(s1.focused).toBe('b')
    expect(s1.value).toBe('a')
  })

  it('manual activation: activateFocused sets value', () => {
    const s0 = init({ items: ['a', 'b', 'c'], activation: 'manual' })
    const [s1] = update(s0, { type: 'focusNext', from: 'a' })
    const [s2] = update(s1, { type: 'activateFocused' })
    expect(s2.value).toBe('b')
  })

  it('focusFirst/focusLast skip disabled', () => {
    const s0 = init({ items: ['a', 'b', 'c', 'd'], disabledItems: ['a', 'd'] })
    const [s1] = update(s0, { type: 'focusFirst' })
    expect(s1.focused).toBe('b')
    const [s2] = update(s0, { type: 'focusLast' })
    expect(s2.focused).toBe('c')
  })

  it('setItems reassigns value if current value was removed', () => {
    const s0 = init({ items: ['a', 'b'], value: 'a' })
    const [s1] = update(s0, { type: 'setItems', items: ['b', 'c'] })
    expect(s1.value).toBe('b')
  })

  it('setItems preserves value if still enabled and present', () => {
    const s0 = init({ items: ['a', 'b'], value: 'b' })
    const [s1] = update(s0, { type: 'setItems', items: ['a', 'b', 'c'] })
    expect(s1.value).toBe('b')
  })
})

describe('tabs.connect', () => {
  const parts = connect<Ctx>((s) => s.tabs, vi.fn(), { id: 'tabs1' })

  it('trigger aria-selected reflects active tab', () => {
    const t = parts.item('a').trigger
    expect(t['aria-selected'](wrap(init({ items: ['a', 'b'], value: 'a' })))).toBe(true)
    expect(t['aria-selected'](wrap(init({ items: ['a', 'b'], value: 'b' })))).toBe(false)
  })

  it('trigger aria-controls points to panel id', () => {
    expect(parts.item('a').trigger['aria-controls']).toBe('tabs1:panel:a')
  })

  it('panel aria-labelledby points to trigger id', () => {
    expect(parts.item('a').panel['aria-labelledby']).toBe('tabs1:trigger:a')
  })

  it('trigger tabIndex is 0 only for selected', () => {
    const t = parts.item('a').trigger
    expect(t.tabIndex(wrap(init({ items: ['a', 'b'], value: 'a' })))).toBe(0)
    expect(t.tabIndex(wrap(init({ items: ['a', 'b'], value: 'b' })))).toBe(-1)
  })

  it('panel.hidden reflects inactive', () => {
    const p = parts.item('a').panel
    expect(p.hidden(wrap(init({ items: ['a', 'b'], value: 'a' })))).toBe(false)
    expect(p.hidden(wrap(init({ items: ['a', 'b'], value: 'b' })))).toBe(true)
  })

  it('ArrowRight dispatches focusNext', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tabs, send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.item('a').trigger.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext', from: 'a' })
  })

  it('Enter activates focused', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tabs, send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    p.item('a').trigger.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'activateFocused' })
  })

  it('vertical orientation: ArrowDown navigates, ArrowRight ignored', () => {
    // Render a real DOM tree so closest() can find the list with aria-orientation.
    const root = document.createElement('div')
    root.innerHTML = `
      <div role="tablist" aria-orientation="vertical" data-scope="tabs" data-part="list">
        <button id="t">Tab A</button>
      </div>
    `
    document.body.appendChild(root)
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tabs, send, { id: 'x' })
    const trigger = root.querySelector('#t') as HTMLButtonElement
    // ArrowDown should navigate, ArrowRight should not.
    const ev1 = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    Object.defineProperty(ev1, 'currentTarget', { value: trigger, writable: false })
    p.item('a').trigger.onKeyDown(ev1)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext', from: 'a' })

    send.mockClear()
    const ev2 = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    Object.defineProperty(ev2, 'currentTarget', { value: trigger, writable: false })
    p.item('a').trigger.onKeyDown(ev2)
    expect(send).not.toHaveBeenCalled()
    document.body.removeChild(root)
  })

  it('deselectable: clicking active tab clears value', () => {
    const s0 = init({ items: ['a', 'b'], value: 'a', deselectable: true })
    const [s1] = update(s0, { type: 'focusTab', value: 'a' })
    expect(s1.value).toBe('')
  })

  it('non-deselectable (default): clicking active tab keeps it', () => {
    const s0 = init({ items: ['a', 'b'], value: 'a' })
    const [s1] = update(s0, { type: 'focusTab', value: 'a' })
    expect(s1.value).toBe('a')
  })

  it('loopFocus: false stops at last item', () => {
    const s0 = init({ items: ['a', 'b', 'c'], loopFocus: false })
    const [s1] = update(s0, { type: 'focusNext', from: 'c' })
    expect(s1.focused).toBeNull() // no wrap
    expect(s1.value).toBe('a') // unchanged from init
  })

  it('loopFocus: true (default) wraps', () => {
    const s0 = init({ items: ['a', 'b', 'c'] })
    const [s1] = update(s0, { type: 'focusNext', from: 'c' })
    expect(s1.focused).toBe('a')
  })

  it('indicator part exposes data attrs', () => {
    const p = connect<Ctx>((s) => s.tabs, vi.fn(), { id: 'x' })
    expect(p.indicator['data-scope']).toBe('tabs')
    expect(p.indicator['data-part']).toBe('indicator')
    expect(p.indicator['data-orientation'](wrap(init({ items: ['a'] })))).toBe('horizontal')
  })

  it('watchTabIndicator writes CSS custom properties from active trigger', () => {
    const root = document.createElement('div')
    root.setAttribute('data-scope', 'tabs')
    root.setAttribute('data-part', 'root')
    root.innerHTML = `
      <div data-scope="tabs" data-part="list">
        <button data-scope="tabs" data-part="trigger" data-state="inactive">A</button>
        <button data-scope="tabs" data-part="trigger" data-state="active">B</button>
      </div>
      <div data-scope="tabs" data-part="indicator"></div>
    `
    // jsdom doesn't do layout so offsetLeft/Width stay at 0 — stub them.
    const triggers = root.querySelectorAll('button')
    Object.defineProperty(triggers[0], 'offsetLeft', { value: 0 })
    Object.defineProperty(triggers[0], 'offsetTop', { value: 0 })
    Object.defineProperty(triggers[0], 'offsetWidth', { value: 50 })
    Object.defineProperty(triggers[0], 'offsetHeight', { value: 40 })
    Object.defineProperty(triggers[1], 'offsetLeft', { value: 50 })
    Object.defineProperty(triggers[1], 'offsetTop', { value: 0 })
    Object.defineProperty(triggers[1], 'offsetWidth', { value: 60 })
    Object.defineProperty(triggers[1], 'offsetHeight', { value: 40 })
    document.body.appendChild(root)

    const dispose = watchTabIndicator(root)
    const indicator = root.querySelector<HTMLElement>('[data-part="indicator"]')!
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('50px')
    expect(indicator.style.getPropertyValue('--indicator-width')).toBe('60px')
    expect(indicator.style.getPropertyValue('--indicator-height')).toBe('40px')

    dispose()
    document.body.removeChild(root)
  })

  it('onNavigate fires on click', () => {
    const send = vi.fn()
    const onNavigate = vi.fn()
    const p = connect<Ctx>((s) => s.tabs, send, { id: 'x', onNavigate })
    p.item('b').trigger.onClick(new MouseEvent('click'))
    expect(onNavigate).toHaveBeenCalledWith('b')
  })
})
