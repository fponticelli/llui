import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/toggle-group'
import { rootSignal, signalOf, read } from '../_signal'

describe('toggle-group reducer', () => {
  it('defaults to single mode', () => {
    expect(init().type).toBe('single')
  })

  it('single mode: toggle swaps active value', () => {
    const s0 = init({ type: 'single', items: ['a', 'b', 'c'], value: ['a'] })
    const [s] = update(s0, { type: 'toggle', value: 'b' })
    expect(s.value).toEqual(['b'])
  })

  it('single deselectable: toggle off removes active', () => {
    const s0 = init({ type: 'single', items: ['a'], value: ['a'], deselectable: true })
    const [s] = update(s0, { type: 'toggle', value: 'a' })
    expect(s.value).toEqual([])
  })

  it('single non-deselectable: toggle keeps active', () => {
    const s0 = init({ type: 'single', items: ['a'], value: ['a'], deselectable: false })
    const [s] = update(s0, { type: 'toggle', value: 'a' })
    expect(s.value).toEqual(['a'])
  })

  it('multiple mode: toggle flips each', () => {
    const s0 = init({ type: 'multiple', items: ['a', 'b'], value: [] })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    expect(s1.value).toEqual(['a'])
    const [s2] = update(s1, { type: 'toggle', value: 'b' })
    expect(s2.value).toEqual(['a', 'b'])
    const [s3] = update(s2, { type: 'toggle', value: 'a' })
    expect(s3.value).toEqual(['b'])
  })

  it('ignores disabled items', () => {
    const s0 = init({ items: ['a', 'b'], disabledItems: ['b'] })
    const [s] = update(s0, { type: 'toggle', value: 'b' })
    expect(s.value).toEqual([])
  })

  it('init defaults dir to ltr', () => {
    expect(init({ items: ['a'] }).dir).toBe('ltr')
  })

  it('setDir updates direction even when group is disabled', () => {
    const [s] = update(init({ items: ['a'], disabled: true }), { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
  })
})

describe('toggle-group roving focus', () => {
  it('init starts with no focused item', () => {
    expect(init({ items: ['a', 'b'] }).focused).toBeNull()
  })

  it('focusNext moves focus to the next item without changing value', () => {
    const s0 = init({ items: ['a', 'b', 'c'], value: ['a'] })
    const [s] = update(s0, { type: 'focusNext', from: 'a' })
    expect(s.focused).toBe('b')
    // navigation must NOT toggle/select
    expect(s.value).toEqual(['a'])
  })

  it('focusPrev moves focus to the previous item', () => {
    const s0 = init({ items: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'focusPrev', from: 'b' })
    expect(s.focused).toBe('a')
  })

  it('focusNext wraps at the end', () => {
    const s0 = init({ items: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'focusNext', from: 'c' })
    expect(s.focused).toBe('a')
  })

  it('focusPrev wraps at the start', () => {
    const s0 = init({ items: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'focusPrev', from: 'a' })
    expect(s.focused).toBe('c')
  })

  it('focusNext skips disabled items', () => {
    const s0 = init({ items: ['a', 'b', 'c'], disabledItems: ['b'] })
    const [s] = update(s0, { type: 'focusNext', from: 'a' })
    expect(s.focused).toBe('c')
  })

  it('focusPrev skips disabled items', () => {
    const s0 = init({ items: ['a', 'b', 'c'], disabledItems: ['b'] })
    const [s] = update(s0, { type: 'focusPrev', from: 'c' })
    expect(s.focused).toBe('a')
  })

  it('does not wrap when loopFocus is false', () => {
    const s0 = init({ items: ['a', 'b', 'c'], loopFocus: false })
    const [last] = update(s0, { type: 'focusNext', from: 'c' })
    expect(last.focused).toBeNull()
    const [first] = update(s0, { type: 'focusPrev', from: 'a' })
    expect(first.focused).toBeNull()
  })

  it('disabled group blocks focus navigation', () => {
    const s0 = init({ items: ['a', 'b'], disabled: true })
    const [s] = update(s0, { type: 'focusNext', from: 'a' })
    expect(s.focused).toBeNull()
  })
})

describe('toggle-group.connect', () => {
  const p = connect(rootSignal(), vi.fn())

  it('root has role=group', () => {
    expect(p.root.role).toBe('group')
  })

  it('item aria-pressed reflects value', () => {
    const a = p.item('a').root
    expect(read(a['aria-pressed'], init({ items: ['a', 'b'], value: ['a'] }))).toBe(true)
    expect(read(a['aria-pressed'], init({ items: ['a', 'b'], value: ['b'] }))).toBe(false)
  })

  it('item click sends toggle', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.item('a').root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle', value: 'a' })
  })

  it('horizontal: ArrowRight/Left send focusNext/Prev', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ items: ['a', 'b', 'c'] })), send)
    pc.item('a').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    pc.item('b').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    )
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusPrev', from: 'b' })
  })

  it('horizontal rtl: ArrowLeft/Right flip to focusNext/Prev', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ items: ['a', 'b', 'c'], dir: 'rtl' })), send)
    pc.item('a').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    )
    pc.item('b').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusPrev', from: 'b' })
  })

  it('horizontal: ArrowUp/Down do nothing', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ items: ['a', 'b', 'c'] })), send)
    pc.item('a').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
    )
    pc.item('a').root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).not.toHaveBeenCalled()
  })

  it('vertical: ArrowDown/Up send focusNext/Prev', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ items: ['a', 'b', 'c'], orientation: 'vertical' })), send)
    // jsdom: orientation is read from the DOM root's data-orientation
    const item = pc.item('a').root
    // build a vertical event target so the closest() lookup resolves
    const root = document.createElement('div')
    root.setAttribute('data-scope', 'toggle-group')
    root.setAttribute('data-part', 'root')
    root.setAttribute('data-orientation', 'vertical')
    const btn = document.createElement('button')
    btn.setAttribute('data-value', 'a')
    root.appendChild(btn)
    document.body.appendChild(root)
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    Object.defineProperty(down, 'currentTarget', { value: btn })
    item.onKeyDown(down)
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    Object.defineProperty(up, 'currentTarget', { value: btn })
    item.onKeyDown(up)
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusPrev', from: 'a' })
    document.body.removeChild(root)
  })

  it('vertical: ArrowRight/Left do nothing', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ items: ['a', 'b', 'c'], orientation: 'vertical' })), send)
    const item = pc.item('a').root
    const root = document.createElement('div')
    root.setAttribute('data-scope', 'toggle-group')
    root.setAttribute('data-part', 'root')
    root.setAttribute('data-orientation', 'vertical')
    const btn = document.createElement('button')
    root.appendChild(btn)
    document.body.appendChild(root)
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    Object.defineProperty(right, 'currentTarget', { value: btn })
    item.onKeyDown(right)
    expect(send).not.toHaveBeenCalled()
    document.body.removeChild(root)
  })

  it('vertical rtl: vertical arrows are NOT flipped', () => {
    const send = vi.fn()
    const pc = connect(
      signalOf(init({ items: ['a', 'b', 'c'], orientation: 'vertical', dir: 'rtl' })),
      send,
    )
    const item = pc.item('a').root
    const root = document.createElement('div')
    root.setAttribute('data-scope', 'toggle-group')
    root.setAttribute('data-part', 'root')
    root.setAttribute('data-orientation', 'vertical')
    const btn = document.createElement('button')
    btn.setAttribute('data-value', 'a')
    root.appendChild(btn)
    document.body.appendChild(root)
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    Object.defineProperty(down, 'currentTarget', { value: btn })
    item.onKeyDown(down)
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    Object.defineProperty(up, 'currentTarget', { value: btn })
    item.onKeyDown(up)
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusPrev', from: 'a' })
    document.body.removeChild(root)
  })

  it('Space/Enter send toggle', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ items: ['a', 'b'] })), send)
    pc.item('a').root.onKeyDown(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    pc.item('a').root.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'toggle', value: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'toggle', value: 'a' })
  })

  it('roving tabindex: exactly one tab stop, follows focused', () => {
    const pc = connect(rootSignal(), vi.fn())
    const a = pc.item('a').root
    const b = pc.item('b').root
    const c = pc.item('c').root
    const focusedB = init({ items: ['a', 'b', 'c'], value: ['a'], focused: 'b' })
    expect(read(a.tabindex, focusedB)).toBe(-1)
    expect(read(b.tabindex, focusedB)).toBe(0)
    expect(read(c.tabindex, focusedB)).toBe(-1)
  })

  it('roving tabindex: when none focused, selected item is the tab stop', () => {
    const pc = connect(rootSignal(), vi.fn())
    const a = pc.item('a').root
    const b = pc.item('b').root
    const s = init({ items: ['a', 'b', 'c'], value: ['b'] })
    expect(read(a.tabindex, s)).toBe(-1)
    expect(read(b.tabindex, s)).toBe(0)
  })

  it('roving tabindex: when none focused/selected, first enabled is the tab stop', () => {
    const pc = connect(rootSignal(), vi.fn())
    const a = pc.item('a').root
    const b = pc.item('b').root
    const s = init({ items: ['a', 'b', 'c'], disabledItems: ['a'] })
    expect(read(a.tabindex, s)).toBe(-1)
    expect(read(b.tabindex, s)).toBe(0)
  })

  it('roving tabindex: disabled item is never a tab stop', () => {
    const pc = connect(rootSignal(), vi.fn())
    const a = pc.item('a').root
    const s = init({ items: ['a', 'b'], disabledItems: ['a'], focused: 'a' })
    expect(read(a.tabindex, s)).toBe(-1)
  })

  it('onFocus syncs the focused item (roving)', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.item('b').root.onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({ type: 'focusItem', value: 'b' })
  })
})
