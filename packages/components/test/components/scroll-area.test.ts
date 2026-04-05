import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  showScrollbars,
  thumbPosition,
  thumbSize,
} from '../../src/components/scroll-area'
import type { ScrollAreaState } from '../../src/components/scroll-area'

type Ctx = { s: ScrollAreaState }
const wrap = (s: ScrollAreaState): Ctx => ({ s })

const dims = (opts: Partial<ScrollAreaState>): ScrollAreaState => ({
  ...init(),
  ...opts,
})

describe('scroll-area reducer', () => {
  it('starts with zero dims + hover visibility', () => {
    expect(init()).toMatchObject({
      scrollTop: 0,
      scrollWidth: 0,
      visibility: 'hover',
      overflowX: false,
      overflowY: false,
    })
  })

  it('setScroll records dims + derives overflow flags', () => {
    const [s] = update(init(), {
      type: 'setScroll',
      scrollTop: 50,
      scrollLeft: 0,
      scrollWidth: 500,
      scrollHeight: 1000,
      clientWidth: 500,
      clientHeight: 300,
    })
    expect(s.scrollTop).toBe(50)
    expect(s.overflowX).toBe(false) // scrollWidth === clientWidth
    expect(s.overflowY).toBe(true) // 1000 > 300
  })

  it('setHovered + setScrolling toggle flags', () => {
    const [s1] = update(init(), { type: 'setHovered', hovered: true })
    expect(s1.hovered).toBe(true)
    const [s2] = update(s1, { type: 'setScrolling', scrolling: true })
    expect(s2.scrolling).toBe(true)
  })
})

describe('showScrollbars', () => {
  it('always returns true with always + overflow', () => {
    const s = dims({ overflowY: true, visibility: 'always' })
    expect(showScrollbars(s, 'y')).toBe(true)
  })

  it('returns false with always when no overflow', () => {
    const s = dims({ overflowY: false, visibility: 'always' })
    expect(showScrollbars(s, 'y')).toBe(false)
  })

  it('hover requires hovered=true', () => {
    expect(showScrollbars(dims({ overflowY: true, visibility: 'hover' }), 'y')).toBe(false)
    expect(
      showScrollbars(dims({ overflowY: true, visibility: 'hover', hovered: true }), 'y'),
    ).toBe(true)
  })

  it('scroll requires scrolling=true', () => {
    expect(showScrollbars(dims({ overflowY: true, visibility: 'scroll' }), 'y')).toBe(false)
    expect(
      showScrollbars(dims({ overflowY: true, visibility: 'scroll', scrolling: true }), 'y'),
    ).toBe(true)
  })
})

describe('thumbPosition / thumbSize', () => {
  it('thumbPosition returns 0 when no scroll', () => {
    expect(
      thumbPosition(dims({ scrollTop: 0, scrollHeight: 1000, clientHeight: 300 }), 'y'),
    ).toBe(0)
  })

  it('thumbPosition returns proportional position', () => {
    // scrolled halfway: scrollTop / (scrollHeight - clientHeight) = 350/700 = 0.5
    const s = dims({ scrollTop: 350, scrollHeight: 1000, clientHeight: 300 })
    expect(thumbPosition(s, 'y')).toBeCloseTo(0.5)
  })

  it('thumbSize is proportion of visible/total', () => {
    const s = dims({ scrollHeight: 1000, clientHeight: 300 })
    expect(thumbSize(s, 'y')).toBeCloseTo(0.3)
  })

  it('thumbSize has a minimum floor for usability', () => {
    const s = dims({ scrollHeight: 10_000, clientHeight: 100 })
    expect(thumbSize(s, 'y')).toBeGreaterThanOrEqual(0.05)
  })
})

describe('scroll-area.connect', () => {
  it('root mouseenter/leave dispatch setHovered', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.s, send)
    p.root.onMouseEnter(new MouseEvent('mouseenter'))
    expect(send).toHaveBeenCalledWith({ type: 'setHovered', hovered: true })
    p.root.onMouseLeave(new MouseEvent('mouseleave'))
    expect(send).toHaveBeenCalledWith({ type: 'setHovered', hovered: false })
  })

  it('viewport onScroll dispatches setScroll with dims', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.s, send)
    const el = document.createElement('div')
    Object.defineProperties(el, {
      scrollTop: { value: 10 },
      scrollLeft: { value: 5 },
      scrollWidth: { value: 500 },
      scrollHeight: { value: 1000 },
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    })
    p.viewport.onScroll({ target: el } as unknown as Event)
    expect(send).toHaveBeenCalledWith({
      type: 'setScroll',
      scrollTop: 10,
      scrollLeft: 5,
      scrollWidth: 500,
      scrollHeight: 1000,
      clientWidth: 400,
      clientHeight: 300,
    })
  })

  it('thumbY style writes top + height', () => {
    const p = connect<Ctx>((s) => s.s, vi.fn())
    const s = dims({ scrollTop: 350, scrollHeight: 1000, clientHeight: 300 })
    const style = p.thumbY.style(wrap(s))
    expect(style).toContain('top:')
    expect(style).toContain('height:')
  })

  it('scrollbarY data-visible reflects state', () => {
    const p = connect<Ctx>((s) => s.s, vi.fn())
    const hidden = dims({ visibility: 'hover', overflowY: true })
    expect(p.scrollbarY['data-visible'](wrap(hidden))).toBeUndefined()
    const shown = dims({ visibility: 'hover', overflowY: true, hovered: true })
    expect(p.scrollbarY['data-visible'](wrap(shown))).toBe('')
  })
})
