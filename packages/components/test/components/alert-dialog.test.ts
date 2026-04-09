import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/alert-dialog'
import type { AlertDialogState } from '../../src/components/alert-dialog'

type Ctx = { d: AlertDialogState }
const wrap = (d: AlertDialogState): Ctx => ({ d })

describe('alert-dialog', () => {
  it('reuses dialog reducer', () => {
    expect(init()).toEqual({ open: false })
    const [s] = update(init(), { type: 'open' })
    expect(s.open).toBe(true)
  })

  it('connect forces role=alertdialog', () => {
    const p = connect<Ctx>((s) => s.d, vi.fn(), { id: 'a1' })
    expect(p.content.role).toBe('alertdialog')
  })

  it('inherits dialog parts', () => {
    const p = connect<Ctx>((s) => s.d, vi.fn(), { id: 'a1' })
    expect(p.trigger['aria-expanded'](wrap({ open: true }))).toBe(true)
    const label = p.closeTrigger['aria-label']
    expect(typeof label === 'function' ? label(wrap({ open: false })) : label).toBe('Close')
  })
})
