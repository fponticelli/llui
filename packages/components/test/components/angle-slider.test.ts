import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  angleFromPoint,
  pointFromAngle,
} from '../../src/components/angle-slider'
import type { AngleSliderState } from '../../src/components/angle-slider'

type Ctx = { a: AngleSliderState }
const wrap = (a: AngleSliderState): Ctx => ({ a })

describe('angle-slider reducer', () => {
  it('initializes at 0 by default', () => {
    expect(init().value).toBe(0)
  })

  it('clamps initial value to range', () => {
    expect(init({ value: 500 }).value).toBe(360)
    expect(init({ value: -30 }).value).toBe(0)
  })

  it('setValue clamps + snaps to step', () => {
    const s0 = init({ step: 5 })
    const [s1] = update(s0, { type: 'setValue', value: 42 })
    expect(s1.value).toBe(40)
    const [s2] = update(s0, { type: 'setValue', value: 500 })
    expect(s2.value).toBe(360)
  })

  it('increment/decrement by step', () => {
    const s0 = init({ value: 10, step: 5 })
    const [s1] = update(s0, { type: 'increment' })
    expect(s1.value).toBe(15)
    const [s2] = update(s1, { type: 'decrement' })
    expect(s2.value).toBe(10)
  })

  it('increment with custom steps', () => {
    const s0 = init({ value: 0, step: 1 })
    const [s1] = update(s0, { type: 'increment', steps: 10 })
    expect(s1.value).toBe(10)
  })

  it('disabled blocks value changes', () => {
    const s0 = init({ disabled: true, value: 50 })
    const [s1] = update(s0, { type: 'setValue', value: 100 })
    expect(s1.value).toBe(50)
  })

  it('readOnly blocks value changes', () => {
    const s0 = init({ readOnly: true, value: 50 })
    const [s1] = update(s0, { type: 'increment' })
    expect(s1.value).toBe(50)
  })

  it('setMin/setMax adjust range + clamp value', () => {
    const s0 = init({ value: 180 })
    const [s1] = update(s0, { type: 'setMax', max: 90 })
    expect(s1.max).toBe(90)
    expect(s1.value).toBe(90)
  })
})

describe('angleFromPoint / pointFromAngle', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect

  it('0° = directly above center', () => {
    expect(angleFromPoint(rect, 50, 0)).toBe(0)
  })

  it('90° = directly right of center', () => {
    expect(angleFromPoint(rect, 100, 50)).toBe(90)
  })

  it('180° = directly below center', () => {
    expect(angleFromPoint(rect, 50, 100)).toBe(180)
  })

  it('270° = directly left of center', () => {
    expect(angleFromPoint(rect, 0, 50)).toBe(270)
  })

  it('pointFromAngle inverts angleFromPoint', () => {
    const p0 = pointFromAngle(0)
    expect(Math.round(p0.x * 100) / 100).toBe(0)
    expect(Math.round(p0.y * 100) / 100).toBe(-1) // y grows downward in DOM
    const p90 = pointFromAngle(90)
    expect(Math.round(p90.x * 100) / 100).toBe(1)
  })
})

describe('angle-slider.connect', () => {
  it('aria-value* reflect state', () => {
    const p = connect<Ctx>((s) => s.a, vi.fn())
    const s = wrap(init({ value: 90 }))
    expect(p.root['aria-valuenow'](s)).toBe(90)
    expect(p.root['aria-valuemin'](s)).toBe(0)
    expect(p.root['aria-valuemax'](s)).toBe(360)
    expect(p.root['aria-valuetext'](s)).toBe('90°')
  })

  it('keyboard ArrowRight/Up increments', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.a, send)
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.root.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'increment' })
  })

  it('PageUp increments by 10 steps', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.a, send)
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: 'PageUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment', steps: 10 })
  })

  it('Home/End jump to extremes', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.a, send)
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'setValue', value: -Infinity })
    p.root.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'setValue', value: Infinity })
  })

  it('custom format for aria-valuetext', () => {
    const p = connect<Ctx>((s) => s.a, vi.fn(), { format: (v) => `${v} degrees` })
    expect(p.root['aria-valuetext'](wrap(init({ value: 45 })))).toBe('45 degrees')
  })

  it('hiddenInput includes name when provided', () => {
    const p = connect<Ctx>((s) => s.a, vi.fn(), { name: 'angle' })
    expect(p.hiddenInput.name).toBe('angle')
    expect(p.hiddenInput.value(wrap(init({ value: 30 })))).toBe('30')
  })
})
