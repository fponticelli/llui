import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, focusTarget } from '../../src/components/accordion'

type Ctx = { acc: ReturnType<typeof init> }
const wrap = (acc: ReturnType<typeof init>): Ctx => ({ acc })

describe('accordion reducer', () => {
  it('initializes with defaults (single, collapsible)', () => {
    const s = init()
    expect(s).toEqual({
      value: [],
      multiple: false,
      collapsible: true,
      disabled: false,
      items: [],
    })
  })

  it('toggle opens a closed item (single)', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'toggle', value: 'a' })
    expect(s.value).toEqual(['a'])
  })

  it('toggle closes an open item (single + collapsible)', () => {
    const [s] = update(init({ items: ['a', 'b'], value: ['a'] }), { type: 'toggle', value: 'a' })
    expect(s.value).toEqual([])
  })

  it('toggle switches items (single, not closing previous)', () => {
    const [s] = update(init({ items: ['a', 'b'], value: ['a'] }), { type: 'toggle', value: 'b' })
    expect(s.value).toEqual(['b'])
  })

  it('toggle cannot close last open item when collapsible=false', () => {
    const [s] = update(init({ items: ['a'], value: ['a'], collapsible: false }), {
      type: 'toggle',
      value: 'a',
    })
    expect(s.value).toEqual(['a'])
  })

  it('multiple mode keeps multiple items open', () => {
    const s0 = init({ items: ['a', 'b', 'c'], multiple: true })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    const [s2] = update(s1, { type: 'toggle', value: 'b' })
    expect(s2.value).toEqual(['a', 'b'])
  })

  it('multiple mode can close any item', () => {
    const s0 = init({ items: ['a', 'b'], value: ['a', 'b'], multiple: true })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    expect(s1.value).toEqual(['b'])
  })

  it('open is idempotent', () => {
    const [s] = update(init({ value: ['a'] }), { type: 'open', value: 'a' })
    expect(s.value).toEqual(['a'])
  })

  it('close respects collapsible=false in single mode', () => {
    const [s] = update(init({ value: ['a'], collapsible: false }), {
      type: 'close',
      value: 'a',
    })
    expect(s.value).toEqual(['a'])
  })

  it('disabled blocks all state mutations', () => {
    const s0 = init({ disabled: true })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    expect(s1.value).toEqual([])
  })
})

describe('focusTarget', () => {
  const items = ['a', 'b', 'c']
  const s = init({ items })

  it('focusNext wraps around', () => {
    expect(focusTarget(s, { type: 'focusNext', value: 'a' })).toBe('b')
    expect(focusTarget(s, { type: 'focusNext', value: 'c' })).toBe('a')
  })

  it('focusPrev wraps around', () => {
    expect(focusTarget(s, { type: 'focusPrev', value: 'a' })).toBe('c')
    expect(focusTarget(s, { type: 'focusPrev', value: 'b' })).toBe('a')
  })

  it('focusFirst/Last', () => {
    expect(focusTarget(s, { type: 'focusFirst' })).toBe('a')
    expect(focusTarget(s, { type: 'focusLast' })).toBe('c')
  })

  it('returns null for unknown value', () => {
    expect(focusTarget(s, { type: 'focusNext', value: 'zzz' })).toBeNull()
  })
})

describe('accordion.connect', () => {
  const parts = connect<Ctx>((s) => s.acc, vi.fn(), { id: 'acc1' })

  it('item.trigger aria-controls points to content id', () => {
    expect(parts.item('a').trigger['aria-controls']).toBe('acc1:content:a')
    expect(parts.item('a').trigger.id).toBe('acc1:trigger:a')
  })

  it('item.content aria-labelledby points to trigger id', () => {
    expect(parts.item('a').content['aria-labelledby']).toBe('acc1:trigger:a')
    expect(parts.item('a').content.id).toBe('acc1:content:a')
  })

  it('item aria-expanded reflects open state', () => {
    const a = parts.item('a').trigger
    expect(a['aria-expanded'](wrap(init({ value: ['a'] })))).toBe(true)
    expect(a['aria-expanded'](wrap(init({ value: [] })))).toBe(false)
  })

  it('item content.hidden reflects closed state', () => {
    const a = parts.item('a').content
    expect(a.hidden(wrap(init({ value: ['a'] })))).toBe(false)
    expect(a.hidden(wrap(init({ value: [] })))).toBe(true)
  })

  it('click sends toggle', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.acc, send, { id: 'x' })
    p.item('a').trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle', value: 'a' })
  })

  it('ArrowDown/Up dispatch focus messages and preventDefault', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.acc, send, { id: 'x' })
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    p.item('a').trigger.onKeyDown(down)
    expect(down.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext', value: 'a' })
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    p.item('b').trigger.onKeyDown(up)
    expect(send).toHaveBeenCalledWith({ type: 'focusPrev', value: 'b' })
  })

  it('Home/End dispatch focusFirst/focusLast', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.acc, send, { id: 'x' })
    p.item('a').trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    p.item('a').trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusFirst' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusLast' })
  })
})
