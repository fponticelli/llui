import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flip, mergeTransitions } from '../src/flip'
import { fade } from '../src/presets'

describe('flip()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Stub rAF — run callbacks synchronously for deterministic tests.
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      cb(0)
      return 0 as unknown as number
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function makeEl(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('returns TransitionOptions with enter, leave, and onTransition', () => {
    const f = flip()
    expect(typeof f.enter).toBe('function')
    expect(typeof f.leave).toBe('function')
    expect(typeof f.onTransition).toBe('function')
  })

  it('captures position on enter', () => {
    const el = makeEl()
    // Give the element a known rect via override
    const rect = { left: 10, top: 20, width: 50, height: 50 } as DOMRect
    el.getBoundingClientRect = () => rect
    const f = flip()
    f.enter!([el])
    // Positions map is private; infer by triggering onTransition
    // and checking no animation was created (no delta).
    const animateSpy = vi.fn()
    el.animate = animateSpy as unknown as typeof el.animate
    f.onTransition!({ entering: [], leaving: [], parent: document.body })
    expect(animateSpy).not.toHaveBeenCalled() // same position, no anim
  })

  it('animates elements whose position changed', () => {
    const el = makeEl()
    const animateSpy = vi.fn()
    el.animate = animateSpy as unknown as typeof el.animate

    let rect = { left: 0, top: 0, width: 50, height: 50 } as DOMRect
    el.getBoundingClientRect = () => rect

    const f = flip({ duration: 200, easing: 'ease-in' })
    f.enter!([el])
    // Move element
    rect = { left: 100, top: 50, width: 50, height: 50 } as DOMRect
    f.onTransition!({ entering: [], leaving: [], parent: document.body })
    expect(animateSpy).toHaveBeenCalledTimes(1)
    const [keyframes, options] = animateSpy.mock.calls[0]!
    expect(keyframes).toEqual([
      { transform: 'translate(-100px, -50px)' },
      { transform: 'translate(0, 0)' },
    ])
    expect(options).toMatchObject({ duration: 200, easing: 'ease-in' })
  })

  it('stops tracking elements after leave', () => {
    const el = makeEl()
    const animateSpy = vi.fn()
    el.animate = animateSpy as unknown as typeof el.animate
    let rect = { left: 0, top: 0, width: 50, height: 50 } as DOMRect
    el.getBoundingClientRect = () => rect

    const f = flip()
    f.enter!([el])
    f.leave!([el])
    rect = { left: 100, top: 0, width: 50, height: 50 } as DOMRect
    f.onTransition!({ entering: [], leaving: [], parent: document.body })
    expect(animateSpy).not.toHaveBeenCalled()
  })

  it('drops disconnected elements from tracking', () => {
    const el = makeEl()
    const animateSpy = vi.fn()
    el.animate = animateSpy as unknown as typeof el.animate
    el.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect

    const f = flip()
    f.enter!([el])
    document.body.removeChild(el) // disconnect
    f.onTransition!({ entering: [], leaving: [], parent: document.body })
    expect(animateSpy).not.toHaveBeenCalled()
  })
})

describe('mergeTransitions()', () => {
  it('chains enter handlers', () => {
    const calls: string[] = []
    const merged = mergeTransitions(
      { enter: () => void calls.push('a') },
      { enter: () => void calls.push('b') },
    )
    merged.enter!([])
    expect(calls).toEqual(['a', 'b'])
  })

  it('chains onTransition handlers', () => {
    const calls: string[] = []
    const merged = mergeTransitions(
      { onTransition: () => void calls.push('a') },
      { onTransition: () => void calls.push('b') },
    )
    merged.onTransition!({ entering: [], leaving: [], parent: document.body })
    expect(calls).toEqual(['a', 'b'])
  })

  it('waits for all leave promises', async () => {
    let resolveA: (() => void) | null = null
    let resolveB: (() => void) | null = null
    const merged = mergeTransitions(
      { leave: () => new Promise<void>((r) => (resolveA = r)) },
      { leave: () => new Promise<void>((r) => (resolveB = r)) },
    )
    let done = false
    void (merged.leave!([]) as Promise<void>).then(() => {
      done = true
    })
    expect(done).toBe(false)
    resolveA!()
    await Promise.resolve()
    expect(done).toBe(false)
    resolveB!()
    await new Promise((r) => setTimeout(r, 0))
    expect(done).toBe(true)
  })

  it('combines fade + flip without conflicts', () => {
    const m = mergeTransitions(fade({ duration: 100 }), flip({ duration: 200 }))
    expect(typeof m.enter).toBe('function')
    expect(typeof m.leave).toBe('function')
    expect(typeof m.onTransition).toBe('function')
  })

  it('omits handlers no part provides', () => {
    const m = mergeTransitions({ enter: () => {} })
    expect(m.enter).toBeDefined()
    expect(m.leave).toBeUndefined()
    expect(m.onTransition).toBeUndefined()
  })
})
