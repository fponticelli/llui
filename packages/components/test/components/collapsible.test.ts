import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/collapsible'
import type { CollapsibleState } from '../../src/components/collapsible'

type Ctx = { c: CollapsibleState }
const wrap = (c: CollapsibleState): Ctx => ({ c })

describe('collapsible reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false, disabled: false })
  })

  it('toggle alternates', () => {
    const [s1] = update(init(), { type: 'toggle' })
    expect(s1.open).toBe(true)
    const [s2] = update(s1, { type: 'toggle' })
    expect(s2.open).toBe(false)
  })

  it('open/close explicit', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
  })

  it('disabled blocks toggling', () => {
    const [s] = update(init({ disabled: true }), { type: 'toggle' })
    expect(s.open).toBe(false)
  })
})

describe('collapsible.connect', () => {
  const p = connect<Ctx>((s) => s.c, vi.fn(), { id: 'c1' })

  it('trigger aria-expanded reflects open', () => {
    expect(p.trigger['aria-expanded'](wrap(init({ open: true })))).toBe(true)
    expect(p.trigger['aria-expanded'](wrap(init({ open: false })))).toBe(false)
  })

  it('trigger aria-controls → content id', () => {
    expect(p.trigger['aria-controls']).toBe('c1:content')
  })

  it('content aria-labelledby → trigger id', () => {
    expect(p.content['aria-labelledby']).toBe('c1:trigger')
  })

  it('content.hidden reflects closed', () => {
    expect(p.content.hidden(wrap(init({ open: true })))).toBe(false)
    expect(p.content.hidden(wrap(init({ open: false })))).toBe(true)
  })

  it('trigger click sends toggle', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.c, send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })
})
