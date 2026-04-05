import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/avatar'
import type { AvatarState } from '../../src/components/avatar'

type Ctx = { a: AvatarState }
const wrap = (a: AvatarState): Ctx => ({ a })

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
  const p = connect<Ctx>((s) => s.a, vi.fn(), { alt: 'Profile' })

  it('image hidden until loaded', () => {
    expect(p.image.hidden(wrap({ status: 'loading' }))).toBe(true)
    expect(p.image.hidden(wrap({ status: 'loaded' }))).toBe(false)
  })

  it('fallback visible until loaded', () => {
    expect(p.fallback.hidden(wrap({ status: 'loading' }))).toBe(false)
    expect(p.fallback.hidden(wrap({ status: 'loaded' }))).toBe(true)
  })

  it('fallback aria-hidden when image loaded', () => {
    expect(p.fallback['aria-hidden'](wrap({ status: 'loaded' }))).toBe('true')
    expect(p.fallback['aria-hidden'](wrap({ status: 'error' }))).toBeUndefined()
  })

  it('image onLoad sends loaded', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.a, send)
    pc.image.onLoad(new Event('load'))
    expect(send).toHaveBeenCalledWith({ type: 'loaded' })
  })

  it('image onError sends error', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.a, send)
    pc.image.onError(new Event('error'))
    expect(send).toHaveBeenCalledWith({ type: 'error' })
  })
})
