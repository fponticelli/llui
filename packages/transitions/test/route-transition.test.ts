import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { routeTransition } from '../src/route-transition'
import { fade } from '../src/presets'

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('routeTransition()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns enter and leave functions', () => {
    const t = routeTransition()
    expect(typeof t.enter).toBe('function')
    expect(typeof t.leave).toBe('function')
  })

  it('enter applies animation styles to nodes', () => {
    const el = makeEl()
    const t = routeTransition({ duration: 200 })
    t.enter!([el])
    // After enter, the element should have opacity and transform applied
    // (fade sets opacity to 1, slide sets transform)
    expect(el.style.opacity).toBe('1')
    expect(el.style.transform).toBe('translate(0, 0)')
  })

  it('leave returns a Promise', () => {
    const el = makeEl()
    const t = routeTransition({ duration: 100 })
    const result = t.leave!([el])
    expect(result).toBeInstanceOf(Promise)
  })

  it('leave applies fade-out styles', () => {
    const el = makeEl()
    const t = routeTransition({ duration: 100 })
    void t.leave!([el])
    expect(el.style.opacity).toBe('0')
  })

  it('uses default duration of 250ms', () => {
    const el = makeEl()
    const t = routeTransition()
    t.enter!([el])
    expect(el.style.transition).toContain('250ms')
  })

  it('respects custom duration', () => {
    const el = makeEl()
    const t = routeTransition({ duration: 400 })
    t.enter!([el])
    expect(el.style.transition).toContain('400ms')
  })

  it('disables slide when slide=false', () => {
    const el = makeEl()
    const t = routeTransition({ duration: 100, slide: false })
    t.enter!([el])
    expect(el.style.opacity).toBe('1')
    // No transform should be applied (fade-only)
    expect(el.style.transform).toBe('')
  })

  it('accepts a pre-built TransitionOptions (passthrough)', () => {
    const preset = fade({ duration: 150 })
    const t = routeTransition(preset)
    expect(t).toBe(preset)
  })

  it('applies custom easing', () => {
    const el = makeEl()
    const t = routeTransition({ duration: 200, easing: 'linear' })
    t.enter!([el])
    expect(el.style.transition).toContain('linear')
  })
})
