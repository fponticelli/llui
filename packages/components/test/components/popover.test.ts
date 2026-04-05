import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/popover'
import type { PopoverState } from '../../src/components/popover'

type Ctx = { pop: PopoverState }
const wrap = (p: PopoverState): Ctx => ({ pop: p })

describe('popover reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false })
  })

  it('open/close/toggle/setOpen', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'toggle' })[0].open).toBe(false)
    expect(update(init(), { type: 'setOpen', open: true })[0].open).toBe(true)
  })
})

describe('popover.connect', () => {
  const parts = connect<Ctx>((s) => s.pop, vi.fn(), { id: 'pop1' })

  it('trigger aria-expanded tracks open state', () => {
    expect(parts.trigger['aria-expanded'](wrap({ open: true }))).toBe(true)
    expect(parts.trigger['aria-expanded'](wrap({ open: false }))).toBe(false)
  })

  it('trigger aria-controls points at content id', () => {
    expect(parts.trigger['aria-controls']).toBe('pop1:content')
  })

  it('trigger onClick toggles', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.pop, send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })

  it('closeTrigger sends close', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.pop, send, { id: 'x' })
    p.closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('content.aria-labelledby points at title id', () => {
    expect(parts.content['aria-labelledby']).toBe('pop1:title')
  })

  it('data-state reflects open state across parts', () => {
    expect(parts.trigger['data-state'](wrap({ open: true }))).toBe('open')
    expect(parts.content['data-state'](wrap({ open: false }))).toBe('closed')
  })

  it('custom closeLabel', () => {
    const p = connect<Ctx>((s) => s.pop, vi.fn(), { id: 'x', closeLabel: 'Dismiss' })
    expect(p.closeTrigger['aria-label']).toBe('Dismiss')
  })
})
