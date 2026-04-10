import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect } from '../../src/components/hover-card'
import type { HoverCardState } from '../../src/components/hover-card'

type Ctx = { h: HoverCardState }
const wrap = (h: HoverCardState): Ctx => ({ h })

describe('hover-card reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false })
  })

  it('show/hide/setOpen', () => {
    expect(update(init(), { type: 'show' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'hide' })[0].open).toBe(false)
    expect(update(init(), { type: 'setOpen', open: true })[0].open).toBe(true)
  })
})

describe('hover-card.connect', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pointerEnter schedules open after delay', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.h, send, { id: 'x', openDelay: 500 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledWith({ type: 'show' })
  })

  it('pointerLeave schedules close after delay', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.h, send, { id: 'x', closeDelay: 200 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('content pointerEnter cancels pending close', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.h, send, { id: 'x', closeDelay: 100 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(50)
    p.content.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(500)
    expect(send).not.toHaveBeenCalled()
  })

  it('data-state tracks open state', () => {
    const p = connect<Ctx>((s) => s.h, vi.fn(), { id: 'x' })
    expect(p.trigger['data-state'](wrap({ open: true }))).toBe('open')
    expect(p.trigger['data-state'](wrap({ open: false }))).toBe('closed')
  })

  it('trigger aria-controls points at content id', () => {
    const p = connect<Ctx>((s) => s.h, vi.fn(), { id: 'hc1' })
    expect(p.trigger['aria-controls']).toBe('hc1:content')
  })
})
