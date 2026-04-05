import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isRunning,
  cssAnimationDirection,
  axis,
} from '../../src/components/marquee'
import type { MarqueeState } from '../../src/components/marquee'

type Ctx = { m: MarqueeState }
const wrap = (m: MarqueeState): Ctx => ({ m })

describe('marquee reducer', () => {
  it('initializes running + left-direction + 20s', () => {
    expect(init()).toMatchObject({
      running: true,
      direction: 'left',
      durationSec: 20,
      hovered: false,
    })
  })

  it('play/pause/toggle flip running', () => {
    const [s1] = update(init({ running: false }), { type: 'play' })
    expect(s1.running).toBe(true)
    const [s2] = update(s1, { type: 'pause' })
    expect(s2.running).toBe(false)
    const [s3] = update(s2, { type: 'toggle' })
    expect(s3.running).toBe(true)
  })

  it('hoverPause sets hovered without touching running', () => {
    const [s] = update(init(), { type: 'hoverPause' })
    expect(s.hovered).toBe(true)
    expect(s.running).toBe(true)
  })

  it('isRunning derived: respects hovered + pauseOnHover', () => {
    expect(isRunning(init())).toBe(true)
    expect(isRunning(init({ running: false }))).toBe(false)
    expect(isRunning(init({ disabled: true }))).toBe(false)
    // pauseOnHover + hovered → not running
    expect(isRunning({ ...init({ pauseOnHover: true }), hovered: true })).toBe(false)
    // hovered but pauseOnHover false → still running
    expect(isRunning({ ...init({ pauseOnHover: false }), hovered: true })).toBe(true)
  })

  it('setDirection + setDuration', () => {
    const [s1] = update(init(), { type: 'setDirection', direction: 'up' })
    expect(s1.direction).toBe('up')
    const [s2] = update(s1, { type: 'setDuration', durationSec: 5 })
    expect(s2.durationSec).toBe(5)
  })

  it('setDuration clamps negative to zero', () => {
    const [s] = update(init(), { type: 'setDuration', durationSec: -5 })
    expect(s.durationSec).toBe(0)
  })

  it('disabled blocks all mutations', () => {
    const s0 = init({ disabled: true, running: true })
    const [s] = update(s0, { type: 'pause' })
    expect(s.running).toBe(true)
  })
})

describe('cssAnimationDirection / axis', () => {
  it('maps directions to CSS animation-direction', () => {
    expect(cssAnimationDirection('left')).toBe('normal')
    expect(cssAnimationDirection('right')).toBe('reverse')
    expect(cssAnimationDirection('up')).toBe('normal')
    expect(cssAnimationDirection('down')).toBe('reverse')
  })

  it('axis picks horizontal vs vertical', () => {
    expect(axis('left')).toBe('horizontal')
    expect(axis('right')).toBe('horizontal')
    expect(axis('up')).toBe('vertical')
    expect(axis('down')).toBe('vertical')
  })
})

describe('marquee.connect', () => {
  it('root style exposes CSS custom properties', () => {
    const p = connect<Ctx>((s) => s.m, vi.fn())
    const style = p.root.style(wrap(init({ durationSec: 10 })))
    expect(style).toContain('--marquee-duration:10s')
    expect(style).toContain('--marquee-playstate:running')
    expect(style).toContain('--marquee-direction:normal')
  })

  it('style reflects paused state when pauseOnHover + hovered', () => {
    const p = connect<Ctx>((s) => s.m, vi.fn())
    const hoveredPaused = { ...init({ pauseOnHover: true }), hovered: true }
    expect(p.root.style(wrap(hoveredPaused))).toContain('--marquee-playstate:paused')
  })

  it('hover handlers dispatch hoverPause/hoverResume', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.m, send)
    p.root.onMouseEnter(new MouseEvent('mouseenter'))
    expect(send).toHaveBeenCalledWith({ type: 'hoverPause' })
    p.root.onMouseLeave(new MouseEvent('mouseleave'))
    expect(send).toHaveBeenCalledWith({ type: 'hoverResume' })
  })
})
