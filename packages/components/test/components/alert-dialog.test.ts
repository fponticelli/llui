import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/alert-dialog'
import { rootSignal, read } from '../_signal'

describe('alert-dialog', () => {
  it('reuses dialog reducer', () => {
    expect(init()).toEqual({ open: false })
    const [s] = update(init(), { type: 'open' })
    expect(s.open).toBe(true)
  })

  it('connect forces role=alertdialog', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'a1' })
    expect(p.content.role).toBe('alertdialog')
  })

  it('inherits dialog parts', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'a1' })
    expect(read(p.trigger['aria-expanded'], { open: true })).toBe(true)
    expect(read(p.closeTrigger['aria-label'], { open: false })).toBe('Close')
  })
})
