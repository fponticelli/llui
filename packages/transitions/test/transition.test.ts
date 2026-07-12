import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transition } from '../src/transition'

describe('transition()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeEl(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('returns TransitionOptions with enter and leave when appear=true', () => {
    const t = transition({ enterFrom: 'a', enterTo: 'b', duration: 100 })
    expect(typeof t.enter).toBe('function')
    expect(typeof t.leave).toBe('function')
  })

  it('omits enter when appear=false', () => {
    const t = transition({ enterFrom: 'a', enterTo: 'b', duration: 100, appear: false })
    expect(t.enter).toBeUndefined()
    expect(typeof t.leave).toBe('function')
  })

  it('applies enterFrom + enterActive, then swaps to enterTo on enter', () => {
    const el = makeEl()
    const t = transition({
      enterFrom: 'from',
      enterTo: 'to',
      enterActive: 'active',
      duration: 100,
    })
    t.enter!([el])
    // After reflow, enterFrom removed, enterTo added; active still present.
    expect(el.classList.contains('from')).toBe(false)
    expect(el.classList.contains('to')).toBe(true)
    expect(el.classList.contains('active')).toBe(true)
  })

  it('removes transient classes after duration elapses', async () => {
    const el = makeEl()
    const t = transition({
      enterFrom: 'from',
      enterTo: 'to',
      enterActive: 'active',
      duration: 100,
    })
    t.enter!([el])
    await vi.advanceTimersByTimeAsync(200)
    expect(el.classList.contains('to')).toBe(false)
    expect(el.classList.contains('active')).toBe(false)
  })

  it('leave returns a Promise that resolves after duration', async () => {
    const el = makeEl()
    const t = transition({
      leaveFrom: 'visible',
      leaveTo: 'gone',
      leaveActive: 'leaving',
      duration: 100,
    })
    let resolved = false
    void (t.leave!([el]) as Promise<void>).then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(resolved).toBe(true)
  })

  it('leave swaps leaveFrom → leaveTo', () => {
    const el = makeEl()
    const t = transition({
      leaveFrom: 'visible',
      leaveTo: 'gone',
      leaveActive: 'leaving',
      duration: 100,
    })
    void t.leave!([el])
    expect(el.classList.contains('visible')).toBe(false)
    expect(el.classList.contains('gone')).toBe(true)
    expect(el.classList.contains('leaving')).toBe(true)
  })

  it('applies style objects via element.style', () => {
    const el = makeEl()
    const t = transition({
      enterFrom: { opacity: 0 },
      enterTo: { opacity: 1 },
      duration: 100,
    })
    t.enter!([el])
    expect(el.style.opacity).toBe('1')
  })

  it('mixes class strings with style objects via array', () => {
    const el = makeEl()
    const t = transition({
      enterFrom: ['fade', { opacity: 0 }],
      enterTo: ['fade-in', { opacity: 1 }],
      duration: 100,
    })
    t.enter!([el])
    expect(el.style.opacity).toBe('1')
    expect(el.classList.contains('fade-in')).toBe(true)
    expect(el.classList.contains('fade')).toBe(false)
  })

  it('applies px unit to dimensional numeric values', () => {
    const el = makeEl()
    const t = transition({
      enterFrom: { width: 0, height: 0 },
      enterTo: { width: 200, height: 100 },
      duration: 100,
    })
    t.enter!([el])
    expect(el.style.width).toBe('200px')
    expect(el.style.height).toBe('100px')
  })

  it('leaves unitless properties without px', () => {
    const el = makeEl()
    const t = transition({
      enterTo: { opacity: 0.5, zIndex: 10, fontWeight: 700 },
      duration: 100,
    })
    t.enter!([el])
    expect(el.style.opacity).toBe('0.5')
    expect(el.style.zIndex).toBe('10')
    expect(el.style.fontWeight).toBe('700')
  })

  it('restores an author-set inline value for a camelCase (kebab-mapped) property', async () => {
    const el = makeEl()
    el.style.zIndex = '5' // author-set inline value (camelCase DOM key → z-index)
    const t = transition({ enterTo: { zIndex: 10 }, duration: 100 })
    t.enter!([el])
    expect(el.style.zIndex).toBe('10') // applied during the transition
    // Drive the fallback timer so enter completes and cleanup restores the snapshot.
    await vi.advanceTimersByTimeAsync(200)
    expect(el.style.zIndex).toBe('5') // restored, not blanked
  })

  it('filters out non-element nodes', () => {
    const comment = document.createComment('anchor')
    const el = makeEl()
    const t = transition({ enterTo: 'hi', duration: 50 })
    // Should not throw on comment node
    expect(() => t.enter!([comment, el])).not.toThrow()
    expect(el.classList.contains('hi')).toBe(true)
  })

  it('handles empty node arrays', async () => {
    const t = transition({ enterFrom: 'a', enterTo: 'b', duration: 100 })
    // Should not throw
    expect(() => t.enter!([])).not.toThrow()
    await expect(t.leave!([]) as Promise<void>).resolves.toBeUndefined()
  })

  it('resolves leave immediately when duration is 0', async () => {
    const el = makeEl()
    const t = transition({ leaveTo: { opacity: 0 }, duration: 0 })
    await expect(t.leave!([el]) as Promise<void>).resolves.toBeUndefined()
  })

  // ── Finding 3: completion resolves on transitionend, not just the timer ──
  it('resolves leave on transitionend before the fallback timer', async () => {
    const el = makeEl()
    // Huge duration: if we depended on the timer this would not resolve.
    const t = transition({ leaveTo: { opacity: 0 }, duration: 100_000 })
    let resolved = false
    void (t.leave!([el]) as Promise<void>).then(() => {
      resolved = true
    })
    el.dispatchEvent(new Event('transitionend'))
    // Resolution threads through waitForEnd → Promise.all → outer .then.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(resolved).toBe(true)
  })

  it('enter cleanup fires on transitionend without advancing the timer', async () => {
    const el = makeEl()
    const t = transition({ enterActive: 'active', enterTo: 'to', duration: 100_000 })
    t.enter!([el])
    expect(el.classList.contains('to')).toBe(true)
    el.dispatchEvent(new Event('transitionend'))
    await Promise.resolve()
    await Promise.resolve()
    expect(el.classList.contains('to')).toBe(false)
    expect(el.classList.contains('active')).toBe(false)
  })

  // ── Finding 2: interruption / cancellation ──
  it('a superseding leave rolls back the in-flight enter and gates its cleanup', async () => {
    const el = makeEl()
    const t = transition({
      enterFrom: 'ef',
      enterActive: 'ea',
      enterTo: 'et',
      leaveFrom: 'lf',
      leaveActive: 'la',
      leaveTo: 'lt',
      duration: 100,
    })

    t.enter!([el])
    expect(el.classList.contains('et')).toBe(true)
    expect(el.classList.contains('ea')).toBe(true)

    // Interrupt mid-enter with a leave on the same element.
    void t.leave!([el])
    // Enter's transient values were rolled back by the new run…
    expect(el.classList.contains('et')).toBe(false)
    expect(el.classList.contains('ea')).toBe(false)
    // …and leave's values are applied.
    expect(el.classList.contains('lt')).toBe(true)
    expect(el.classList.contains('la')).toBe(true)

    // Advancing past BOTH durations must not let the superseded enter's
    // delayed cleanup strip the live leave classes.
    await vi.advanceTimersByTimeAsync(500)
    expect(el.classList.contains('lt')).toBe(true)
    expect(el.classList.contains('la')).toBe(true)
  })
})
