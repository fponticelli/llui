import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/avatar'
import { rootSignal, read } from '../_signal'

describe('avatar reducer', () => {
  it('initializes idle by default', () => {
    expect(init()).toEqual({ status: 'idle' })
  })

  it('transitions load→loaded→reset', () => {
    const [a] = update(init(), { type: 'loadStart' })
    expect(a.status).toBe('loading')
    const [b] = update(a, { type: 'loaded' })
    expect(b.status).toBe('loaded')
    const [c] = update(b, { type: 'reset' })
    expect(c.status).toBe('idle')
  })

  it('error transitions', () => {
    const [a] = update(init(), { type: 'loadStart' })
    const [b] = update(a, { type: 'error' })
    expect(b.status).toBe('error')
  })
})

describe('avatar.connect', () => {
  const p = connect(rootSignal(), vi.fn(), { alt: 'Profile' })

  it('image hidden until loaded', () => {
    expect(read(p.image.hidden, { status: 'loading' })).toBe(true)
    expect(read(p.image.hidden, { status: 'loaded' })).toBe(false)
  })

  it('fallback visible until loaded', () => {
    expect(read(p.fallback.hidden, { status: 'loading' })).toBe(false)
    expect(read(p.fallback.hidden, { status: 'loaded' })).toBe(true)
  })

  it('fallback aria-hidden when image loaded', () => {
    expect(read(p.fallback['aria-hidden'], { status: 'loaded' })).toBe('true')
    expect(read(p.fallback['aria-hidden'], { status: 'error' })).toBeUndefined()
  })

  it('image onLoad sends loaded', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.image.onLoad(new Event('load'))
    expect(send).toHaveBeenCalledWith({ type: 'loaded' })
  })

  it('image onError sends error', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.image.onError(new Event('error'))
    expect(send).toHaveBeenCalledWith({ type: 'error' })
  })
})
