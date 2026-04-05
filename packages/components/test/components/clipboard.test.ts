import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/clipboard'
import type { ClipboardState } from '../../src/components/clipboard'

type Ctx = { c: ClipboardState }
const wrap = (c: ClipboardState): Ctx => ({ c })

describe('clipboard reducer', () => {
  it('initializes empty', () => {
    expect(init()).toEqual({ value: '', copied: false })
  })

  it('setValue updates value and clears copied flag', () => {
    const s0 = { ...init({ value: 'old' }), copied: true }
    const [s] = update(s0, { type: 'setValue', value: 'new' })
    expect(s.value).toBe('new')
    expect(s.copied).toBe(false)
  })

  it('copy/copied flips copied flag', () => {
    const [s] = update(init({ value: 'hi' }), { type: 'copy' })
    expect(s.copied).toBe(true)
    const [s2] = update(s, { type: 'reset' })
    expect(s2.copied).toBe(false)
  })
})

describe('clipboard.connect', () => {
  const p = connect<Ctx>((s) => s.c, vi.fn())

  it('trigger onClick sends copy', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.c, send)
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'copy' })
  })

  it('data-copied reflects state', () => {
    expect(p.root['data-copied'](wrap({ value: '', copied: true }))).toBe('')
    expect(p.root['data-copied'](wrap({ value: '', copied: false }))).toBeUndefined()
  })

  it('indicator has aria-live=polite', () => {
    expect(p.indicator['aria-live']).toBe('polite')
  })

  it('input value tracks state', () => {
    expect(p.input.value(wrap({ value: 'hello', copied: false }))).toBe('hello')
  })
})
