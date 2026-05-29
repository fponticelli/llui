import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/collapsible'
import { rootSignal, read } from '../_signal'

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
  const p = connect(rootSignal(), vi.fn(), { id: 'c1' })

  it('trigger aria-expanded reflects open', () => {
    expect(read(p.trigger['aria-expanded'], init({ open: true }))).toBe(true)
    expect(read(p.trigger['aria-expanded'], init({ open: false }))).toBe(false)
  })

  it('trigger aria-controls → content id', () => {
    expect(p.trigger['aria-controls']).toBe('c1:content')
  })

  it('content aria-labelledby → trigger id', () => {
    expect(p.content['aria-labelledby']).toBe('c1:trigger')
  })

  it('content.hidden reflects closed', () => {
    expect(read(p.content.hidden, init({ open: true }))).toBe(false)
    expect(read(p.content.hidden, init({ open: false }))).toBe(true)
  })

  it('trigger click sends toggle', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })
})
