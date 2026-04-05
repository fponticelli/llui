import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect } from '../../src/components/tooltip'
import type { TooltipState } from '../../src/components/tooltip'

type Ctx = { tip: TooltipState }
const wrap = (t: TooltipState): Ctx => ({ tip: t })

describe('tooltip reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false })
  })

  it('show/hide/toggle/setOpen', () => {
    expect(update(init(), { type: 'show' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'hide' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
  })
})

describe('tooltip.connect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pointerEnter schedules show after delay', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x', delayOpen: 200 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(199)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(send).toHaveBeenCalledWith({ type: 'show' })
  })

  it('pointerLeave schedules hide after delay', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x', delayClose: 100 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(99)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('pointerLeave before delay cancels pending show', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x', delayOpen: 300, delayClose: 0 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(100)
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('focus opens immediately when openOnFocus=true', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x' })
    p.trigger.onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({ type: 'show' })
  })

  it('focus does nothing when openOnFocus=false', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x', openOnFocus: false })
    p.trigger.onFocus(new FocusEvent('focus'))
    expect(send).not.toHaveBeenCalled()
  })

  it('blur closes immediately', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x' })
    p.trigger.onBlur(new FocusEvent('blur'))
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('Escape closes immediately and cancels timers', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x', delayOpen: 300 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    p.trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('aria-describedby only set when open', () => {
    const p = connect<Ctx>((s) => s.tip, vi.fn(), { id: 'tip1' })
    expect(p.trigger['aria-describedby'](wrap({ open: true }))).toBe('tip1:content')
    expect(p.trigger['aria-describedby'](wrap({ open: false }))).toBeUndefined()
  })

  it('content pointerEnter cancels pending hide (interactive tooltip)', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.tip, send, { id: 'x', delayClose: 100 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(50)
    p.content.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(500)
    expect(send).not.toHaveBeenCalled()
  })
})
