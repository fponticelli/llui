import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/toolbar'
import { rootSignal, read } from '../_signal'

describe('toolbar reducer', () => {
  it('initializes horizontal, looping, no focus', () => {
    expect(init()).toMatchObject({
      focused: null,
      orientation: 'horizontal',
      loopFocus: true,
      disabled: false,
    })
  })

  it('setFocused sets focus', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'setFocused', value: 'b' })
    expect(s.focused).toBe('b')
  })

  it('setFocused ignores unknown or disabled items', () => {
    const s0 = init({ items: ['a', 'b'], disabledItems: ['b'] })
    expect(update(s0, { type: 'setFocused', value: 'b' })[0].focused).toBeNull()
    expect(update(s0, { type: 'setFocused', value: 'z' })[0].focused).toBeNull()
  })

  it('focusNext wraps when looping', () => {
    const [s] = update(init({ items: ['a', 'b', 'c'], focused: 'c' }), {
      type: 'focusNext',
      from: 'c',
    })
    expect(s.focused).toBe('a')
  })

  it('focusNext does not wrap when loopFocus is false', () => {
    const s0 = init({ items: ['a', 'b', 'c'], focused: 'c', loopFocus: false })
    const [s] = update(s0, { type: 'focusNext', from: 'c' })
    expect(s.focused).toBe('c')
  })

  it('focusPrev does not wrap from first when loopFocus is false', () => {
    const s0 = init({ items: ['a', 'b', 'c'], focused: 'a', loopFocus: false })
    const [s] = update(s0, { type: 'focusPrev', from: 'a' })
    expect(s.focused).toBe('a')
  })

  it('focusNext skips disabled items (separators are disabled values)', () => {
    const s0 = init({ items: ['a', 'sep', 'c'], disabledItems: ['sep'], focused: 'a' })
    const [s] = update(s0, { type: 'focusNext', from: 'a' })
    expect(s.focused).toBe('c')
  })

  it('focusFirst/focusLast respect disabled', () => {
    const s0 = init({ items: ['a', 'b', 'c', 'd'], disabledItems: ['a', 'd'] })
    expect(update(s0, { type: 'focusFirst' })[0].focused).toBe('b')
    expect(update(s0, { type: 'focusLast' })[0].focused).toBe('c')
  })

  it('setItems drops focus if no longer valid', () => {
    const s0 = init({ items: ['a', 'b'], focused: 'a' })
    const [s] = update(s0, { type: 'setItems', items: ['b', 'c'] })
    expect(s.focused).toBeNull()
  })

  it('disabled toolbar blocks focus moves but allows setItems', () => {
    const s0 = init({ items: ['a', 'b'], disabled: true })
    expect(update(s0, { type: 'focusFirst' })[0].focused).toBeNull()
    const [s] = update(s0, { type: 'setItems', items: ['x', 'y'] })
    expect(s.items).toEqual(['x', 'y'])
  })
})

describe('toolbar.connect', () => {
  it('root has role=toolbar and aria-label from opts', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb', label: 'Formatting' })
    expect(p.root.role).toBe('toolbar')
    expect(p.root['aria-label']).toBe('Formatting')
    expect(p.root['data-scope']).toBe('toolbar')
  })

  it('aria-orientation reflects state', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb' })
    expect(read(p.root['aria-orientation'], init({ orientation: 'vertical' }))).toBe('vertical')
  })

  it('single tab stop: only focused item has tabindex 0', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb' })
    const a = p.item('a').root
    const b = p.item('b').root
    const st = init({ items: ['a', 'b'], focused: 'b' })
    expect(read(a.tabindex, st)).toBe(-1)
    expect(read(b.tabindex, st)).toBe(0)
  })

  it('first enabled item is the tab stop when none focused', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb' })
    const a = p.item('a').root
    const b = p.item('b').root
    const st = init({ items: ['a', 'b'], focused: null })
    expect(read(a.tabindex, st)).toBe(0)
    expect(read(b.tabindex, st)).toBe(-1)
  })

  it('disabled item is never a tab stop', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb' })
    const a = p.item('a').root
    const b = p.item('b').root
    const st = init({ items: ['a', 'b'], disabledItems: ['a'], focused: null })
    expect(read(a.tabindex, st)).toBe(-1)
    // first enabled is b, so b is the tab stop
    expect(read(b.tabindex, st)).toBe(0)
  })

  it('onFocus sends setFocused', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'tb' })
    p.item('b').root.onFocus()
    expect(send).toHaveBeenCalledWith({ type: 'setFocused', value: 'b' })
  })

  it('ArrowRight/Left rove in a horizontal toolbar', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'tb' })
    const div = document.createElement('div')
    div.setAttribute('data-orientation', 'horizontal')
    const item = document.createElement('button')
    div.appendChild(item)
    const ev = (key: string): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
      Object.defineProperty(e, 'currentTarget', { value: item, configurable: true })
      return e
    }
    p.item('a').root.onKeyDown(ev('ArrowRight'))
    p.item('b').root.onKeyDown(ev('ArrowLeft'))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusPrev', from: 'b' })
  })

  it('ArrowDown/Up rove in a vertical toolbar', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'tb' })
    const div = document.createElement('div')
    div.setAttribute('data-orientation', 'vertical')
    const item = document.createElement('button')
    div.appendChild(item)
    const ev = (key: string): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
      Object.defineProperty(e, 'currentTarget', { value: item, configurable: true })
      return e
    }
    p.item('a').root.onKeyDown(ev('ArrowDown'))
    p.item('b').root.onKeyDown(ev('ArrowUp'))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusPrev', from: 'b' })
  })

  it('Home/End send focusFirst/focusLast', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'tb' })
    p.item('a').root.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    p.item('a').root.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusFirst' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusLast' })
  })

  it('separator orientation is flipped relative to the toolbar', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb' })
    expect(p.separator.role).toBe('separator')
    expect(read(p.separator['aria-orientation'], init({ orientation: 'horizontal' }))).toBe(
      'vertical',
    )
    expect(read(p.separator['aria-orientation'], init({ orientation: 'vertical' }))).toBe(
      'horizontal',
    )
  })

  it('group exposes role=group with aria-labelledby tied to label id', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tb' })
    const g = p.group('align')
    expect(g.root.role).toBe('group')
    expect(g.root['aria-labelledby']).toBe(g.label.id)
  })
})
