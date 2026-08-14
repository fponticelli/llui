import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isMounted,
  isVisible,
  isAnimating,
  presenceOpen,
  presenceClose,
  presenceEnd,
} from '../../src/components/presence'
import { rootSignal, read } from '../_signal'

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
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root['data-state'], init())).toBe('closed')
    expect(read(p.root['data-state'], { status: 'opening', unmountOnExit: true })).toBe('opening')
  })

  it('onAnimationEnd dispatches animationEnd', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.root.onAnimationEnd({} as AnimationEvent)
    expect(send).toHaveBeenCalledWith({ type: 'animationEnd' })
  })

  it('hidden attribute: true only when closed + kept mounted', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root.hidden, { status: 'closed', unmountOnExit: false })).toBe(true)
    expect(read(p.root.hidden, { status: 'closed', unmountOnExit: true })).toBe(false)
    expect(read(p.root.hidden, { status: 'open', unmountOnExit: false })).toBe(false)
  })
})

describe('the shared overlay presence transitions (#126)', () => {
  it('a redundant open/close comes back by REFERENCE, so it is a true no-op', () => {
    // The reconciler detects change by reference equality per path. A new
    // object with identical fields would mark the slice dirty and re-commit
    // every binding under it, so these guards are load-bearing, not a
    // micro-optimisation.
    const open = { open: true, status: 'open' as const, label: 'x' }
    expect(presenceOpen(open, false)).toBe(open)
    expect(presenceOpen(open, true)).toBe(open)
    const opening = { open: true, status: 'opening' as const }
    expect(presenceOpen(opening, false)).toBe(opening)

    const closed = { open: false, status: 'closed' as const }
    expect(presenceClose(closed, false)).toBe(closed)
    const closing = { open: false, status: 'closing' as const }
    expect(presenceClose(closing, true)).toBe(closing)

    // A status that is neither opening nor closing is likewise untouched.
    expect(presenceEnd(open)).toBe(open)
    expect(presenceEnd(closed)).toBe(closed)
  })

  it('a state that is open but NOT yet settled still transitions', () => {
    // The guard is on the PAIR: `open` alone is not enough, or an overlay
    // opened while its exit animation runs would never leave 'closing'.
    expect(presenceOpen({ open: true, status: 'closing' }, false)).toEqual({
      open: true,
      status: 'opening',
    })
    expect(presenceClose({ open: false, status: 'opening' }, false)).toEqual({
      open: false,
      status: 'closing',
    })
  })

  it('finishing the exit leaves open and status consistent', () => {
    expect(presenceEnd({ open: true, status: 'opening' })).toEqual({ open: true, status: 'open' })
    // `open: false` here is unreachable in practice — 'closing' is only ever
    // written with `open: false` — but the pair is kept consistent anyway.
    expect(presenceEnd({ open: true, status: 'closing' })).toEqual({
      open: false,
      status: 'closed',
    })
  })
})
