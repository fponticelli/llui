import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/menu'
import type { MenuState } from '../../src/components/menu'

type Ctx = { m: MenuState }
const wrap = (m: MenuState): Ctx => ({ m })

describe('menu reducer', () => {
  it('initializes closed with no highlight', () => {
    expect(init({ items: ['a', 'b'] })).toMatchObject({
      open: false,
      items: ['a', 'b'],
      highlighted: null,
    })
  })

  it('open highlights first enabled item', () => {
    const [s] = update(init({ items: ['a', 'b', 'c'] }), { type: 'open' })
    expect(s.open).toBe(true)
    expect(s.highlighted).toBe('a')
  })

  it('open skips disabled items for initial highlight', () => {
    const [s] = update(init({ items: ['a', 'b', 'c'], disabledItems: ['a'] }), {
      type: 'open',
    })
    expect(s.highlighted).toBe('b')
  })

  it('open preserves existing highlight', () => {
    const s0 = init({ items: ['a', 'b'], highlighted: 'b' })
    const [s] = update(s0, { type: 'open' })
    expect(s.highlighted).toBe('b')
  })

  it('close clears highlight + typeahead', () => {
    const s0 = { ...init({ items: ['a'] }), open: true, highlighted: 'a' }
    const [s] = update(s0, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.highlighted).toBeNull()
  })

  it('toggle alternates', () => {
    const [s1] = update(init({ items: ['a'] }), { type: 'toggle' })
    expect(s1.open).toBe(true)
    const [s2] = update(s1, { type: 'toggle' })
    expect(s2.open).toBe(false)
  })

  it('highlightNext wraps', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), highlighted: 'c' }
    const [s] = update(s0, { type: 'highlightNext' })
    expect(s.highlighted).toBe('a')
  })

  it('highlightNext skips disabled', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'], disabledItems: ['b'] }), highlighted: 'a' }
    const [s] = update(s0, { type: 'highlightNext' })
    expect(s.highlighted).toBe('c')
  })

  it('highlightPrev wraps backwards', () => {
    const s0 = { ...init({ items: ['a', 'b', 'c'] }), highlighted: 'a' }
    const [s] = update(s0, { type: 'highlightPrev' })
    expect(s.highlighted).toBe('c')
  })

  it('highlight directly sets value', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'highlight', value: 'b' })
    expect(s.highlighted).toBe('b')
  })

  it('highlight ignores disabled items', () => {
    const [s] = update(init({ items: ['a', 'b'], disabledItems: ['b'] }), {
      type: 'highlight',
      value: 'b',
    })
    expect(s.highlighted).toBeNull()
  })

  it('select closes menu', () => {
    const s0 = { ...init({ items: ['a', 'b'] }), open: true, highlighted: 'a' }
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(false)
    expect(s.highlighted).toBeNull()
  })

  it('select ignored for disabled items', () => {
    const s0 = { ...init({ items: ['a', 'b'], disabledItems: ['b'] }), open: true }
    const [s] = update(s0, { type: 'select', value: 'b' })
    expect(s.open).toBe(true)
  })

  it('selectHighlighted closes when highlighted is set', () => {
    const s0 = { ...init({ items: ['a', 'b'] }), open: true, highlighted: 'a' }
    const [s] = update(s0, { type: 'selectHighlighted' })
    expect(s.open).toBe(false)
  })

  it('selectHighlighted no-op when highlight is null', () => {
    const s0 = { ...init({ items: ['a'] }), open: true, highlighted: null }
    const [s] = update(s0, { type: 'selectHighlighted' })
    expect(s.open).toBe(true)
  })

  it('typeahead single-char jumps to next match', () => {
    const s0 = { ...init({ items: ['apple', 'banana', 'apricot'] }), highlighted: 'apple' }
    const [s] = update(s0, { type: 'typeahead', char: 'a', now: 1000 })
    expect(s.highlighted).toBe('apricot')
  })

  it('typeahead accumulates within timeout', () => {
    const s0 = init({ items: ['apple', 'banana', 'apricot', 'berry'] })
    const [s1] = update(s0, { type: 'typeahead', char: 'a', now: 1000 })
    const [s2] = update(s1, { type: 'typeahead', char: 'p', now: 1100 })
    expect(s2.highlighted).toBe('apple')
    const [s3] = update(s2, { type: 'typeahead', char: 'r', now: 1200 })
    expect(s3.highlighted).toBe('apricot')
  })

  it('typeahead resets after timeout', () => {
    const s0 = init({ items: ['apple', 'banana'] })
    const [s1] = update(s0, { type: 'typeahead', char: 'a', now: 1000 })
    const [s2] = update(s1, { type: 'typeahead', char: 'b', now: 5000 })
    expect(s2.typeahead).toBe('b')
    expect(s2.highlighted).toBe('banana')
  })

  it('setItems clears highlight if invalidated', () => {
    const s0 = { ...init({ items: ['a', 'b'] }), highlighted: 'a' }
    const [s] = update(s0, { type: 'setItems', items: ['c', 'd'] })
    expect(s.highlighted).toBeNull()
  })

  it('setItems preserves highlight if still valid', () => {
    const s0 = { ...init({ items: ['a', 'b'] }), highlighted: 'a' }
    const [s] = update(s0, { type: 'setItems', items: ['a', 'c'] })
    expect(s.highlighted).toBe('a')
  })
})

describe('menu.connect', () => {
  const parts = connect<Ctx>((s) => s.m, vi.fn(), { id: 'm1' })

  it('trigger aria-haspopup=menu', () => {
    expect(parts.trigger['aria-haspopup']).toBe('menu')
  })

  it('trigger aria-expanded tracks open', () => {
    expect(parts.trigger['aria-expanded'](wrap(init({ open: true })))).toBe(true)
    expect(parts.trigger['aria-expanded'](wrap(init({ open: false })))).toBe(false)
  })

  it('trigger click toggles', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('trigger ArrowDown opens menu', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    p.trigger.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })

  it('trigger ArrowUp opens + highlights last', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'open' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'highlightLast' })
  })

  it('content ArrowDown highlights next', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext' })
  })

  it('content Enter selects highlighted', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectHighlighted' })
  })

  it('content Escape closes', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('content single-char sends typeahead', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'typeahead', char: 'a' }))
  })

  it('item click sends select + invokes onSelect callback', () => {
    const send = vi.fn()
    const onSelect = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x', onSelect })
    p.item('a').item.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'select', value: 'a' })
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('item pointerMove highlights', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send, { id: 'x' })
    p.item('b').item.onPointerMove(new PointerEvent('pointermove'))
    expect(send).toHaveBeenCalledWith({ type: 'highlight', value: 'b' })
  })

  it('item data-state highlighted reflects state', () => {
    const p = connect<Ctx>((s) => s.m, vi.fn(), { id: 'x' })
    const itemA = p.item('a').item
    const s1 = { ...init({ items: ['a', 'b'] }), highlighted: 'a' }
    const s2 = { ...init({ items: ['a', 'b'] }), highlighted: 'b' }
    expect(itemA['data-state']({ m: s1 } as Ctx)).toBe('highlighted')
    expect(itemA['data-state']({ m: s2 } as Ctx)).toBeUndefined()
  })
})
