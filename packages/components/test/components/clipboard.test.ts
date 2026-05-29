import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/clipboard'
import { rootSignal, read } from '../_signal'

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
  const p = connect(rootSignal(), vi.fn())

  it('trigger onClick sends copy', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'copy' })
  })

  it('data-copied reflects state', () => {
    expect(read(p.root['data-copied'], { value: '', copied: true })).toBe('')
    expect(read(p.root['data-copied'], { value: '', copied: false })).toBeUndefined()
  })

  it('indicator has aria-live=polite', () => {
    expect(p.indicator['aria-live']).toBe('polite')
  })

  it('input value tracks state', () => {
    expect(read(p.input.value, { value: 'hello', copied: false })).toBe('hello')
  })
})
