import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, itemFill } from '../../src/components/rating-group'
import type { RatingGroupState } from '../../src/components/rating-group'

type Ctx = { r: RatingGroupState }
const wrap = (r: RatingGroupState): Ctx => ({ r })

describe('rating-group reducer', () => {
  it('initializes with value=0', () => {
    expect(init()).toMatchObject({ value: 0, count: 5, allowHalf: false })
  })

  it('setValue clamps to [0,count]', () => {
    const [a] = update(init({ count: 5 }), { type: 'setValue', value: 10 })
    expect(a.value).toBe(5)
    const [b] = update(init({ count: 5 }), { type: 'setValue', value: -2 })
    expect(b.value).toBe(0)
  })

  it('clickItem without halfstep rounds up', () => {
    const [s] = update(init({ count: 5, allowHalf: false }), {
      type: 'clickItem',
      index: 2,
      isLeftHalf: true,
    })
    expect(s.value).toBe(3)
  })

  it('clickItem with halfstep left-half → .5', () => {
    const [s] = update(init({ count: 5, allowHalf: true }), {
      type: 'clickItem',
      index: 2,
      isLeftHalf: true,
    })
    expect(s.value).toBe(2.5)
  })

  it('hover updates hoveredValue', () => {
    const [s] = update(init(), { type: 'hover', value: 3 })
    expect(s.hoveredValue).toBe(3)
  })

  it('increment by default step', () => {
    const [a] = update(init({ value: 2, allowHalf: false }), { type: 'incrementValue' })
    expect(a.value).toBe(3)
    const [b] = update(init({ value: 2, allowHalf: true }), { type: 'incrementValue' })
    expect(b.value).toBe(2.5)
  })

  it('decrement clamps to 0', () => {
    const [s] = update(init({ value: 0 }), { type: 'decrementValue' })
    expect(s.value).toBe(0)
  })

  it('readOnly blocks mutations', () => {
    const [s] = update(init({ value: 2, readOnly: true }), { type: 'incrementValue' })
    expect(s.value).toBe(2)
  })
})

describe('itemFill', () => {
  it('full when reference ≥ item value', () => {
    expect(itemFill(init({ value: 3 }), 2)).toBe('full')
    expect(itemFill(init({ value: 3 }), 1)).toBe('full')
  })

  it('empty when reference < item value', () => {
    expect(itemFill(init({ value: 1 }), 2)).toBe('empty')
  })

  it('half when allowHalf and reference is at .5', () => {
    expect(itemFill(init({ value: 2.5, allowHalf: true }), 2)).toBe('half')
  })

  it('uses hoveredValue when present', () => {
    const s = { ...init({ value: 3 }), hoveredValue: 1 }
    expect(itemFill(s, 2)).toBe('empty')
  })
})

describe('rating-group.connect', () => {
  const parts = connect<Ctx>((s) => s.r, vi.fn())

  it('root has role=radiogroup', () => {
    expect(parts.root.role).toBe('radiogroup')
  })

  it('item data-fill reflects state', () => {
    const item2 = parts.item(2).root
    expect(item2['data-fill'](wrap(init({ value: 3 })))).toBe('full')
    expect(item2['data-fill'](wrap(init({ value: 1 })))).toBe('empty')
  })

  it('item onPointerLeave sends hover null', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.r, send)
    p.item(0).root.onPointerLeave(new PointerEvent('pointerleave'))
    expect(send).toHaveBeenCalledWith({ type: 'hover', value: null })
  })

  it('ArrowRight sends increment', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.r, send)
    p.item(0).root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'incrementValue' })
  })

  it('End sends toEnd', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.r, send)
    p.item(0).root.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'toEnd' })
  })
})
