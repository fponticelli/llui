import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, canGoNext, canGoPrev } from '../../src/components/carousel'
import type { CarouselState } from '../../src/components/carousel'

type Ctx = { c: CarouselState }
const wrap = (c: CarouselState): Ctx => ({ c })

describe('carousel reducer', () => {
  it('initializes at index 0', () => {
    expect(init({ count: 3 })).toMatchObject({ current: 0, count: 3, loop: true })
  })

  it('next increments', () => {
    const s0 = init({ count: 3 })
    const [s] = update(s0, { type: 'next' })
    expect(s.current).toBe(1)
  })

  it('next wraps in loop mode', () => {
    const s0 = init({ count: 3, current: 2, loop: true })
    const [s] = update(s0, { type: 'next' })
    expect(s.current).toBe(0)
  })

  it('next stays at end without loop', () => {
    const s0 = init({ count: 3, current: 2, loop: false })
    const [s] = update(s0, { type: 'next' })
    expect(s.current).toBe(2)
  })

  it('prev wraps backwards in loop mode', () => {
    const s0 = init({ count: 3, current: 0, loop: true })
    const [s] = update(s0, { type: 'prev' })
    expect(s.current).toBe(2)
  })

  it('goTo clamps', () => {
    const s0 = init({ count: 3 })
    expect(update(s0, { type: 'goTo', index: 10 })[0].current).toBe(1)
    expect(update(s0, { type: 'goTo', index: -5 })[0].current).toBe(1)
  })

  it('direction tracks last transition', () => {
    const s0 = init({ count: 3 })
    expect(update(s0, { type: 'next' })[0].direction).toBe('forward')
    expect(update({ ...s0, current: 2 }, { type: 'prev' })[0].direction).toBe('backward')
  })

  it('pause/resume toggle paused flag', () => {
    const [s] = update(init(), { type: 'pause' })
    expect(s.paused).toBe(true)
    const [s2] = update(s, { type: 'resume' })
    expect(s2.paused).toBe(false)
  })

  it('setCount clamps current if past new end', () => {
    const s0 = init({ count: 5, current: 4 })
    const [s] = update(s0, { type: 'setCount', count: 2 })
    expect(s.count).toBe(2)
    expect(s.current).toBe(1)
  })
})

describe('navigation helpers', () => {
  it('canGoNext respects loop', () => {
    expect(canGoNext(init({ count: 3, current: 2, loop: false }))).toBe(false)
    expect(canGoNext(init({ count: 3, current: 2, loop: true }))).toBe(true)
  })

  it('canGoPrev respects loop', () => {
    expect(canGoPrev(init({ count: 3, current: 0, loop: false }))).toBe(false)
    expect(canGoPrev(init({ count: 3, current: 0, loop: true }))).toBe(true)
  })
})

describe('carousel.connect', () => {
  const p = connect<Ctx>((s) => s.c, vi.fn(), { id: 'c1' })

  it('root pointerEnter sends pause', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.c, send, { id: 'x' })
    pc.root.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).toHaveBeenCalledWith({ type: 'pause' })
  })

  it('nextTrigger disabled when cannot go next', () => {
    expect(p.nextTrigger.disabled(wrap(init({ count: 3, current: 2, loop: false })))).toBe(true)
    expect(p.nextTrigger.disabled(wrap(init({ count: 3, current: 2, loop: true })))).toBe(false)
  })

  it('slide hidden when not active', () => {
    const slide1 = p.slide(1).slide
    expect(slide1.hidden(wrap(init({ count: 3, current: 1 })))).toBe(false)
    expect(slide1.hidden(wrap(init({ count: 3, current: 0 })))).toBe(true)
  })

  it('indicator click goes to slide', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.c, send, { id: 'x' })
    pc.slide(2).indicator.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 2 })
  })

  it('slide aria-controls matches id', () => {
    expect(p.slide(0).indicator['aria-controls']).toBe('c1:slide:0')
    expect(p.slide(0).slide.id).toBe('c1:slide:0')
  })
})
