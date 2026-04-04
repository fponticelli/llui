import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fade, slide, scale, collapse } from '../src/presets'

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('fade()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sets opacity 0 → 1 on enter', () => {
    const el = makeEl()
    const t = fade({ duration: 100 })
    t.enter!([el])
    expect(el.style.opacity).toBe('1')
  })

  it('sets opacity 1 → 0 on leave', () => {
    const el = makeEl()
    const t = fade({ duration: 100 })
    void t.leave!([el])
    expect(el.style.opacity).toBe('0')
  })

  it('applies custom easing', () => {
    const el = makeEl()
    const t = fade({ duration: 200, easing: 'ease-in' })
    t.enter!([el])
    expect(el.style.transition).toContain('ease-in')
    expect(el.style.transition).toContain('200ms')
  })

  it('appear=false disables enter', () => {
    const t = fade({ appear: false })
    expect(t.enter).toBeUndefined()
  })
})

describe('slide()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('slides from above with direction=down', () => {
    const el = makeEl()
    const t = slide({ direction: 'down', distance: 30, duration: 100 })
    void t.leave!([el])
    expect(el.style.transform).toBe('translate(0, -30px)')
  })

  it('slides from below with direction=up', () => {
    const el = makeEl()
    const t = slide({ direction: 'up', distance: 20, duration: 100 })
    void t.leave!([el])
    expect(el.style.transform).toBe('translate(0, 20px)')
  })

  it('final enter transform is identity', () => {
    const el = makeEl()
    const t = slide({ direction: 'up', duration: 100 })
    t.enter!([el])
    expect(el.style.transform).toBe('translate(0, 0)')
  })

  it('includes opacity when fade=true (default)', () => {
    const el = makeEl()
    const t = slide({ duration: 100 })
    void t.leave!([el])
    expect(el.style.opacity).toBe('0')
  })

  it('omits opacity when fade=false', () => {
    const el = makeEl()
    const t = slide({ duration: 100, fade: false })
    void t.leave!([el])
    expect(el.style.opacity).toBe('')
  })
})

describe('scale()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses from factor on leave', () => {
    const el = makeEl()
    const t = scale({ from: 0.5, duration: 100 })
    void t.leave!([el])
    expect(el.style.transform).toBe('scale(0.5)')
  })

  it('final enter transform is scale(1)', () => {
    const el = makeEl()
    const t = scale({ duration: 100 })
    t.enter!([el])
    expect(el.style.transform).toBe('scale(1)')
  })

  it('applies custom origin', () => {
    const el = makeEl()
    const t = scale({ duration: 100, origin: 'top left' })
    t.enter!([el])
    expect(el.style.transformOrigin).toBe('top left')
  })
})

describe('collapse()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sets height 0 on leave then animates', () => {
    const el = makeEl()
    // jsdom returns 0 for scrollHeight but the code still runs
    const t = collapse({ duration: 100, axis: 'y' })
    void t.leave!([el])
    expect(el.style.overflow).toBe('hidden')
    expect(el.style.height).toBe('0px')
  })

  it('sets width on x axis', () => {
    const el = makeEl()
    const t = collapse({ duration: 100, axis: 'x' })
    void t.leave!([el])
    expect(el.style.width).toBe('0px')
  })
})
