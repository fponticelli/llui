import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect } from '../../src/components/hover-card'
import { rootSignal, read } from '../_signal'

describe('hover-card reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false, status: 'closed', skipAnimations: true })
  })

  it('initializes open in the open status', () => {
    expect(init({ open: true })).toEqual({ open: true, status: 'open', skipAnimations: true })
  })

  it('show/hide/setOpen', () => {
    expect(update(init(), { type: 'show' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'hide' })[0].open).toBe(false)
    expect(update(init(), { type: 'setOpen', open: true })[0].open).toBe(true)
  })
})

describe('hover-card presence lifecycle', () => {
  it('non-animated hide unmounts synchronously (no hang)', () => {
    const shown = update(init(), { type: 'show' })[0]
    expect(shown.status).toBe('open')
    const hidden = update(shown, { type: 'hide' })[0]
    expect(hidden.open).toBe(false)
    expect(hidden.status).toBe('closed')
  })

  it('animated hide holds at closing then resolves on animationEnd', () => {
    const shown = update(init({ skipAnimations: false }), { type: 'show' })[0]
    expect(shown.status).toBe('opening')
    const settled = update(shown, { type: 'animationEnd' })[0]
    expect(settled.status).toBe('open')

    const closing = update(settled, { type: 'hide' })[0]
    expect(closing.open).toBe(false)
    expect(closing.status).toBe('closing')

    const done = update(closing, { type: 'animationEnd' })[0]
    expect(done.status).toBe('closed')
  })

  it('transitionEnd resolves closing the same as animationEnd', () => {
    const closing = update(init({ open: true, skipAnimations: false }), { type: 'hide' })[0]
    expect(closing.status).toBe('closing')
    expect(update(closing, { type: 'transitionEnd' })[0].status).toBe('closed')
  })
})

describe('hover-card.connect', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // Finding 15: a hover-card is not a modal dialog — no role="dialog" on the
  // content and no aria-haspopup="dialog" on the trigger.
  it('content has no dialog role; trigger uses aria-expanded not haspopup', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect('role' in p.content).toBe(false)
    expect('aria-haspopup' in p.trigger).toBe(false)
    expect('aria-expanded' in p.trigger).toBe(true)
  })

  it('pointerEnter schedules open after delay', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', openDelay: 500 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledWith({ type: 'show' })
  })

  it('pointerLeave schedules close after delay', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', closeDelay: 200 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('content pointerEnter cancels pending close', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', closeDelay: 100 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(50)
    p.content.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(500)
    expect(send).not.toHaveBeenCalled()
  })

  it('trigger data-state tracks open state', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(read(p.trigger['data-state'], { open: true })).toBe('open')
    expect(read(p.trigger['data-state'], { open: false })).toBe('closed')
  })

  it('content data-state reflects the full presence status', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(read(p.content['data-state'], { status: 'opening' })).toBe('opening')
    expect(read(p.content['data-state'], { status: 'closing' })).toBe('closing')
    expect(read(p.content['data-state'], { status: 'closed' })).toBe('closed')
  })

  it('content animationEnd/transitionEnd dispatch presence resolution', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onAnimationEnd({} as AnimationEvent)
    expect(send).toHaveBeenCalledWith({ type: 'animationEnd' })
    p.content.onTransitionEnd({} as TransitionEvent)
    expect(send).toHaveBeenCalledWith({ type: 'transitionEnd' })
  })

  it('trigger aria-controls points at content id', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'hc1' })
    expect(p.trigger['aria-controls']).toBe('hc1:content')
  })
})
