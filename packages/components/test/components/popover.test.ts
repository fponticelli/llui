import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/popover'
import { rootSignal, read } from '../_signal'

describe('popover reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false, status: 'closed', skipAnimations: true })
  })

  it('initializes open in the open status', () => {
    expect(init({ open: true })).toEqual({ open: true, status: 'open', skipAnimations: true })
  })

  it('open/close/toggle/setOpen', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'toggle' })[0].open).toBe(false)
    expect(update(init(), { type: 'setOpen', open: true })[0].open).toBe(true)
  })
})

describe('popover presence lifecycle', () => {
  it('non-animated close unmounts synchronously (no hang)', () => {
    const opened = update(init(), { type: 'open' })[0]
    expect(opened.status).toBe('open')
    const closed = update(opened, { type: 'close' })[0]
    expect(closed.open).toBe(false)
    expect(closed.status).toBe('closed')
  })

  it('animated close holds at closing then resolves on animationEnd', () => {
    const opened = update(init({ skipAnimations: false }), { type: 'open' })[0]
    expect(opened.status).toBe('opening')
    const settled = update(opened, { type: 'animationEnd' })[0]
    expect(settled.status).toBe('open')

    const closing = update(settled, { type: 'close' })[0]
    expect(closing.open).toBe(false)
    // Still mounted while the exit animation plays.
    expect(closing.status).toBe('closing')

    const done = update(closing, { type: 'animationEnd' })[0]
    expect(done.status).toBe('closed')
  })

  it('transitionEnd resolves closing the same as animationEnd', () => {
    const closing = update(init({ open: true, skipAnimations: false }), { type: 'close' })[0]
    expect(closing.status).toBe('closing')
    expect(update(closing, { type: 'transitionEnd' })[0].status).toBe('closed')
  })

  it('animationEnd is inert while open or closed', () => {
    const open = update(init({ open: true }), { type: 'animationEnd' })[0]
    expect(open.status).toBe('open')
    const closed = update(init(), { type: 'animationEnd' })[0]
    expect(closed.status).toBe('closed')
  })
})

describe('popover.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { id: 'pop1' })

  it('trigger aria-expanded tracks open state', () => {
    expect(read(parts.trigger['aria-expanded'], { open: true })).toBe(true)
    expect(read(parts.trigger['aria-expanded'], { open: false })).toBe(false)
  })

  it('trigger aria-controls points at content id', () => {
    expect(parts.trigger['aria-controls']).toBe('pop1:content')
  })

  it('trigger onClick toggles', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('closeTrigger sends close', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('content.aria-labelledby points at title id', () => {
    expect(parts.content['aria-labelledby']).toBe('pop1:title')
  })

  it('trigger data-state reflects open state', () => {
    expect(read(parts.trigger['data-state'], { open: true })).toBe('open')
    expect(read(parts.trigger['data-state'], { open: false })).toBe('closed')
  })

  it('content data-state reflects the full presence status', () => {
    expect(read(parts.content['data-state'], { status: 'opening' })).toBe('opening')
    expect(read(parts.content['data-state'], { status: 'open' })).toBe('open')
    expect(read(parts.content['data-state'], { status: 'closing' })).toBe('closing')
    expect(read(parts.content['data-state'], { status: 'closed' })).toBe('closed')
  })

  it('content animationEnd/transitionEnd dispatch presence resolution', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onAnimationEnd({} as AnimationEvent)
    expect(send).toHaveBeenCalledWith({ type: 'animationEnd' })
    p.content.onTransitionEnd({} as TransitionEvent)
    expect(send).toHaveBeenCalledWith({ type: 'transitionEnd' })
  })

  it('custom closeLabel', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x', closeLabel: 'Dismiss' })
    expect(p.closeTrigger['aria-label']).toBe('Dismiss')
  })
})
