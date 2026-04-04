import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  valueFromPoint,
  closestThumbIndex,
} from '../../src/components/slider'

type Ctx = { sl: ReturnType<typeof init> }
const wrap = (sl: ReturnType<typeof init>): Ctx => ({ sl })

describe('slider reducer', () => {
  it('initializes with defaults', () => {
    const s = init()
    expect(s).toMatchObject({ value: [0], min: 0, max: 100, step: 1 })
  })

  it('setValue replaces full value array', () => {
    const [s] = update(init(), { type: 'setValue', value: [25] })
    expect(s.value).toEqual([25])
  })

  it('setThumb clamps to min/max', () => {
    const [a] = update(init(), { type: 'setThumb', index: 0, value: 150 })
    expect(a.value[0]).toBe(100)
    const [b] = update(init(), { type: 'setThumb', index: 0, value: -20 })
    expect(b.value[0]).toBe(0)
  })

  it('setThumb snaps to step', () => {
    const [a] = update(init({ step: 5 }), { type: 'setThumb', index: 0, value: 23 })
    expect(a.value[0]).toBe(25)
    const [b] = update(init({ step: 10 }), { type: 'setThumb', index: 0, value: 14 })
    expect(b.value[0]).toBe(10)
  })

  it('increment adds step', () => {
    const [s] = update(init({ value: [10] }), { type: 'increment', index: 0 })
    expect(s.value[0]).toBe(11)
  })

  it('increment with multiplier', () => {
    const [s] = update(init({ value: [10] }), { type: 'increment', index: 0, multiplier: 10 })
    expect(s.value[0]).toBe(20)
  })

  it('decrement subtracts step and clamps to min', () => {
    const [s] = update(init({ value: [2] }), { type: 'decrement', index: 0, multiplier: 10 })
    expect(s.value[0]).toBe(0)
  })

  it('toMin/toMax jump to bounds', () => {
    const [a] = update(init({ value: [50] }), { type: 'toMin', index: 0 })
    expect(a.value[0]).toBe(0)
    const [b] = update(init({ value: [50] }), { type: 'toMax', index: 0 })
    expect(b.value[0]).toBe(100)
  })

  it('disabled blocks all mutations except setDisabled', () => {
    const s0 = init({ disabled: true, value: [50] })
    const [s1] = update(s0, { type: 'increment', index: 0 })
    expect(s1.value[0]).toBe(50)
    const [s2] = update(s0, { type: 'setDisabled', disabled: false })
    expect(s2.disabled).toBe(false)
  })

  it('range slider enforces gap between thumbs', () => {
    const s0 = init({ value: [20, 80], minStepsBetweenThumbs: 10 })
    const [s1] = update(s0, { type: 'setThumb', index: 0, value: 75 })
    // Gap of 10 means thumb 0 cannot exceed 80-10 = 70
    expect(s1.value[0]).toBe(70)
  })

  it('avoids floating-point drift with fractional steps', () => {
    const [s] = update(init({ step: 0.1 }), { type: 'setThumb', index: 0, value: 0.3 })
    expect(s.value[0]).toBe(0.3)
  })
})

describe('valueFromPoint', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect

  it('horizontal: left edge → min, right edge → max', () => {
    const s = init({ min: 0, max: 100 })
    expect(valueFromPoint(s, rect, 0, 0)).toBe(0)
    expect(valueFromPoint(s, rect, 100, 0)).toBe(100)
    expect(valueFromPoint(s, rect, 50, 0)).toBe(50)
  })

  it('vertical: top → max, bottom → min', () => {
    const s = init({ min: 0, max: 100, orientation: 'vertical' })
    expect(valueFromPoint(s, rect, 0, 0)).toBe(100)
    expect(valueFromPoint(s, rect, 0, 100)).toBe(0)
  })

  it('snaps to step', () => {
    const s = init({ min: 0, max: 100, step: 10 })
    expect(valueFromPoint(s, rect, 47, 0)).toBe(50)
  })
})

describe('closestThumbIndex', () => {
  it('returns index of nearest value', () => {
    const s = init({ value: [10, 50, 90] })
    expect(closestThumbIndex(s, 15)).toBe(0)
    expect(closestThumbIndex(s, 45)).toBe(1)
    expect(closestThumbIndex(s, 100)).toBe(2)
  })
})

describe('slider.connect', () => {
  const parts = connect<Ctx>((s) => s.sl, vi.fn())

  it('thumb aria values reflect state', () => {
    const t = parts.thumb(0).thumb
    const s = wrap(init({ min: 0, max: 200, value: [50] }))
    expect(t['aria-valuemin'](s)).toBe(0)
    expect(t['aria-valuemax'](s)).toBe(200)
    expect(t['aria-valuenow'](s)).toBe(50)
  })

  it('ArrowRight sends increment', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.sl, send)
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.thumb(0).thumb.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })

  it('PageUp sends increment with multiplier 10', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.sl, send)
    p.thumb(1).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'PageUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 1, multiplier: 10 })
  })

  it('Home/End jump to min/max', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.sl, send)
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    p.thumb(0).thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'toMin', index: 0 })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'toMax', index: 0 })
  })

  it('thumb style positions horizontally by percent', () => {
    const p = connect<Ctx>((s) => s.sl, vi.fn())
    const style = p.thumb(0).thumb.style(wrap(init({ value: [50], min: 0, max: 100 })))
    expect(style).toContain('left:50%')
  })

  it('range style spans between thumbs', () => {
    const p = connect<Ctx>((s) => s.sl, vi.fn())
    const style = p.range.style(wrap(init({ value: [20, 80], min: 0, max: 100 })))
    expect(style).toContain('left:20%')
    expect(style).toContain('right:20%')
  })

  it('tabIndex=-1 when disabled', () => {
    const p = connect<Ctx>((s) => s.sl, vi.fn())
    expect(p.thumb(0).thumb.tabIndex(wrap(init({ disabled: true })))).toBe(-1)
    expect(p.thumb(0).thumb.tabIndex(wrap(init({ disabled: false })))).toBe(0)
  })
})
