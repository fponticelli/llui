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
})
