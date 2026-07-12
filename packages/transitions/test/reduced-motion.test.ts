import { describe, it, expect, afterEach } from 'vitest'
import { fade, collapse, spring, stagger } from '../src/index'

/** Install a `matchMedia` stub reporting the given reduced-motion preference. */
function stubReducedMotion(reduce: boolean): void {
  ;(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
    query: string,
  ) =>
    ({
      matches: query.includes('prefers-reduced-motion: reduce') ? reduce : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
})

describe('prefers-reduced-motion', () => {
  it('fade leave resolves instantly (no deferred removal) under reduced motion', async () => {
    stubReducedMotion(true)
    const el = makeEl()
    const t = fade({ duration: 10000 })
    let resolved = false
    void Promise.resolve(t.leave!([el])).then(() => {
      resolved = true
    })
    // Must resolve on the next microtask, NOT after the 10s duration.
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('fade enter leaves the element visible instantly under reduced motion', () => {
    stubReducedMotion(true)
    const el = makeEl()
    fade({ duration: 10000 }).enter!([el])
    // Final (visible) state applied — never parked at opacity 0.
    expect(el.style.opacity === '' || el.style.opacity === '1').toBe(true)
    expect(el.style.opacity).not.toBe('0')
  })

  it('collapse enter does not park the element at height 0 under reduced motion', () => {
    stubReducedMotion(true)
    const el = makeEl()
    collapse({ duration: 10000 }).enter!([el])
    expect(el.style.height).not.toBe('0px')
  })

  it('spring settles to target instantly under reduced motion', async () => {
    stubReducedMotion(true)
    const el = makeEl()
    await spring({ property: 'opacity', from: 0, to: 1 }).leave!([el])
    // Leave target is `from` (0).
    expect(el.style.getPropertyValue('opacity')).toBe('0')
  })

  it('respectReducedMotion:false still animates (opt-out)', async () => {
    stubReducedMotion(true)
    const el = makeEl()
    const t = fade({ duration: 10000, respectReducedMotion: false })
    let resolved = false
    void Promise.resolve(t.leave!([el])).then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()
    // With the opt-out, the leave is NOT instant — still pending after microtasks.
    expect(resolved).toBe(false)
  })

  it('stagger drops per-item delays under reduced motion', async () => {
    stubReducedMotion(true)
    const el1 = makeEl()
    const el2 = makeEl()
    const t = stagger(fade({ duration: 10000 }), { delayPerItem: 5000, leaveOrder: 'sequential' })
    let count = 0
    void Promise.resolve(t.leave!([el1])).then(() => count++)
    void Promise.resolve(t.leave!([el2])).then(() => count++)
    await Promise.resolve()
    await Promise.resolve()
    // Both leaves resolve immediately — no 5s stagger delay applied.
    expect(count).toBe(2)
  })
})
