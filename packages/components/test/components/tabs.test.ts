import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/tabs'

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
})
