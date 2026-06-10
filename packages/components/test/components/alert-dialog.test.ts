import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isMounted, isPresent } from '../../src/components/alert-dialog'
import { rootSignal, read } from '../_signal'

describe('alert-dialog', () => {
  it('reuses dialog reducer', () => {
    expect(init().open).toBe(false)
    expect(init().status).toBe('closed')
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

  it('inherits the dialog presence lifecycle', () => {
    // Default: synchronous close.
    const [closed] = update(init({ open: true }), { type: 'close' })
    expect(closed.status).toBe('closed')
    expect(isMounted(closed)).toBe(false)

    // Animated close: closing → still mounted → animationEnd → closed.
    const [closing] = update(init({ open: true, skipAnimations: false }), { type: 'close' })
    expect(closing.status).toBe('closing')
    expect(isMounted(closing)).toBe(true)
    expect(isPresent(closing)).toBe(true)
    const [done] = update(closing, { type: 'animationEnd' })
    expect(done.status).toBe('closed')
    expect(isMounted(done)).toBe(false)
  })

  it('content data-state surfaces the closing phase', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'a1' })
    expect(
      read(p.content['data-state'], { open: false, status: 'closing', skipAnimations: false }),
    ).toBe('closing')
  })
})
