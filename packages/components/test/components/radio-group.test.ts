import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/radio-group'
import { rootSignal, signalOf, read } from '../_signal'

describe('radio-group reducer', () => {
  it('initializes with no value', () => {
    expect(init()).toMatchObject({ value: null, orientation: 'vertical' })
  })

  it('setValue changes value', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'setValue', value: 'b' })
    expect(s.value).toBe('b')
  })

  it('setValue ignored for disabled items', () => {
    const [s] = update(init({ items: ['a', 'b'], disabledItems: ['b'] }), {
      type: 'setValue',
      value: 'b',
    })
    expect(s.value).toBeNull()
  })

  it('selectNext wraps', () => {
    const s0 = init({ items: ['a', 'b', 'c'], value: 'c' })
    const [s] = update(s0, { type: 'selectNext', from: 'c' })
    expect(s.value).toBe('a')
  })

  it('selectNext skips disabled', () => {
    const s0 = init({ items: ['a', 'b', 'c'], disabledItems: ['b'], value: 'a' })
    const [s] = update(s0, { type: 'selectNext', from: 'a' })
    expect(s.value).toBe('c')
  })

  it('selectFirst/selectLast respect disabled', () => {
    const s0 = init({ items: ['a', 'b', 'c', 'd'], disabledItems: ['a', 'd'] })
    const [s1] = update(s0, { type: 'selectFirst' })
    expect(s1.value).toBe('b')
    const [s2] = update(s0, { type: 'selectLast' })
    expect(s2.value).toBe('c')
  })

  it('setItems drops value if no longer valid', () => {
    const s0 = init({ items: ['a', 'b'], value: 'a' })
    const [s] = update(s0, { type: 'setItems', items: ['b', 'c'] })
    expect(s.value).toBeNull()
  })

  it('disabled group blocks all mutations', () => {
    const s0 = init({ items: ['a', 'b'], disabled: true })
    const [s] = update(s0, { type: 'setValue', value: 'a' })
    expect(s.value).toBeNull()
  })
})

describe('radio-group.connect', () => {
  it('item aria-checked reflects value', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'rg1' })
    const itemA = p.item('a').root
    expect(read(itemA['aria-checked'], init({ items: ['a', 'b'], value: 'a' }))).toBe(true)
    expect(read(itemA['aria-checked'], init({ items: ['a', 'b'], value: 'b' }))).toBe(false)
  })

  it('root has role=radiogroup', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(p.root.role).toBe('radiogroup')
  })

  it('item click sends setValue', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.item('b').root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'setValue', value: 'b' })
  })

  it('ArrowRight/Left sends selectNext/Prev', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: ['a', 'b', 'c'] })), send, { id: 'x' })
    p.item('a').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    p.item('b').root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'selectNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'selectPrev', from: 'b' })
  })

  it('rtl: ArrowLeft/Right flip to selectNext/Prev', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ items: ['a', 'b', 'c'], dir: 'rtl' })), send, { id: 'x' })
    p.item('a').root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    p.item('b').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenNthCalledWith(1, { type: 'selectNext', from: 'a' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'selectPrev', from: 'b' })
  })

  it('rtl: vertical arrows are NOT flipped (vertical orientation)', () => {
    const root = document.createElement('div')
    root.innerHTML = `<div data-orientation="vertical"><button id="t"></button></div>`
    document.body.appendChild(root)
    const send = vi.fn()
    const p = connect(
      signalOf(init({ items: ['a', 'b'], orientation: 'vertical', dir: 'rtl' })),
      send,
      { id: 'x' },
    )
    const trigger = root.querySelector('#t') as HTMLButtonElement
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    Object.defineProperty(down, 'currentTarget', { value: trigger, writable: false })
    p.item('a').root.onKeyDown(down)
    expect(send).toHaveBeenCalledWith({ type: 'selectNext', from: 'a' })

    send.mockClear()
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    Object.defineProperty(up, 'currentTarget', { value: trigger, writable: false })
    p.item('a').root.onKeyDown(up)
    expect(send).toHaveBeenCalledWith({ type: 'selectPrev', from: 'a' })
    document.body.removeChild(root)
  })

  it('setDir updates direction even when group is disabled', () => {
    const [s] = update(init({ items: ['a'], disabled: true }), { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
  })

  it('init defaults dir to ltr', () => {
    expect(init({ items: ['a'] }).dir).toBe('ltr')
  })

  it('tabindex=0 only on selected, first when none', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    const a = p.item('a').root
    const b = p.item('b').root
    expect(read(a.tabindex, init({ items: ['a', 'b'], value: null }))).toBe(0)
    expect(read(b.tabindex, init({ items: ['a', 'b'], value: null }))).toBe(-1)
    expect(read(a.tabindex, init({ items: ['a', 'b'], value: 'b' }))).toBe(-1)
    expect(read(b.tabindex, init({ items: ['a', 'b'], value: 'b' }))).toBe(0)
  })
})
