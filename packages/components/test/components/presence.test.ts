import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isMounted,
  isVisible,
  isAnimating,
} from '../../src/components/presence'
import type { PresenceState } from '../../src/components/presence'

type Ctx = { p: PresenceState }
const wrap = (p: PresenceState): Ctx => ({ p })

describe('presence reducer', () => {
  it('initializes in closed state', () => {
    expect(init().status).toBe('closed')
  })

  it('initializes open when present: true', () => {
    expect(init({ present: true }).status).toBe('open')
  })

  it('open transitions closed → opening', () => {
    const [s] = update(init(), { type: 'open' })
    expect(s.status).toBe('opening')
  })

  it('close transitions open → closing', () => {
    const [s] = update(init({ present: true }), { type: 'close' })
    expect(s.status).toBe('closing')
  })

  it('animationEnd completes transition', () => {
    const [s1] = update(init(), { type: 'open' })
    const [s2] = update(s1, { type: 'animationEnd' })
    expect(s2.status).toBe('open')
    const [s3] = update(s2, { type: 'close' })
    const [s4] = update(s3, { type: 'animationEnd' })
    expect(s4.status).toBe('closed')
  })

  it('open is idempotent from opening/open states', () => {
    const [s1] = update(init({ present: true }), { type: 'open' })
    expect(s1.status).toBe('open')
    const [s2] = update(update(init(), { type: 'open' })[0], { type: 'open' })
    expect(s2.status).toBe('opening')
  })

  it('toggle flips between open and closed', () => {
    const [s1] = update(init(), { type: 'toggle' })
    expect(s1.status).toBe('opening')
    const [s2] = update(update(s1, { type: 'animationEnd' })[0], { type: 'toggle' })
    expect(s2.status).toBe('closing')
  })

  it('setPresent forces status immediately', () => {
    const [s1] = update(init(), { type: 'setPresent', present: true })
    expect(s1.status).toBe('open')
    const [s2] = update(s1, { type: 'setPresent', present: false })
    expect(s2.status).toBe('closed')
  })
})

describe('presence helpers', () => {
  it('isMounted with unmountOnExit: closed hides, others mount', () => {
    expect(isMounted(init())).toBe(false)
    expect(isMounted({ status: 'opening', unmountOnExit: true })).toBe(true)
    expect(isMounted({ status: 'closing', unmountOnExit: true })).toBe(true)
  })

  it('isMounted with unmountOnExit:false always mounts', () => {
    expect(isMounted({ status: 'closed', unmountOnExit: false })).toBe(true)
  })

  it('isVisible: open + opening', () => {
    expect(isVisible({ status: 'open', unmountOnExit: true })).toBe(true)
    expect(isVisible({ status: 'opening', unmountOnExit: true })).toBe(true)
    expect(isVisible({ status: 'closing', unmountOnExit: true })).toBe(false)
    expect(isVisible({ status: 'closed', unmountOnExit: true })).toBe(false)
  })

  it('isAnimating: opening + closing only', () => {
    expect(isAnimating({ status: 'opening', unmountOnExit: true })).toBe(true)
    expect(isAnimating({ status: 'closing', unmountOnExit: true })).toBe(true)
    expect(isAnimating({ status: 'open', unmountOnExit: true })).toBe(false)
  })
})

describe('presence.connect', () => {
  it('root data-state reflects status', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.root['data-state'](wrap(init()))).toBe('closed')
    expect(p.root['data-state'](wrap({ status: 'opening', unmountOnExit: true }))).toBe('opening')
  })

  it('onAnimationEnd dispatches animationEnd', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.p, send)
    p.root.onAnimationEnd({} as AnimationEvent)
    expect(send).toHaveBeenCalledWith({ type: 'animationEnd' })
  })

  it('hidden attribute: true only when closed + kept mounted', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.root.hidden(wrap({ status: 'closed', unmountOnExit: false }))).toBe(true)
    expect(p.root.hidden(wrap({ status: 'closed', unmountOnExit: true }))).toBe(false)
    expect(p.root.hidden(wrap({ status: 'open', unmountOnExit: false }))).toBe(false)
  })
})
