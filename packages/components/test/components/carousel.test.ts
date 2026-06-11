import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  canGoNext,
  canGoPrev,
  swipeDecision,
} from '../../src/components/carousel'
import { rootSignal, signalOf, read } from '../_signal'

describe('carousel reducer', () => {
  it('initializes at index 0', () => {
    expect(init({ count: 3 })).toMatchObject({ current: 0, count: 3, loop: true, dir: 'ltr' })
  })

  it('setDir updates direction', () => {
    const [s] = update(init(), { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
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

describe('swipe drag', () => {
  it('dragStart records startX and zero delta', () => {
    const [s] = update(init({ count: 3 }), { type: 'dragStart', x: 100 })
    expect(s.dragging).toEqual({ startX: 100, deltaX: 0 })
  })

  it('dragMove updates deltaX relative to startX', () => {
    const [s0] = update(init({ count: 3 }), { type: 'dragStart', x: 100 })
    const [s] = update(s0, { type: 'dragMove', x: 70 })
    expect(s.dragging).toEqual({ startX: 100, deltaX: -30 })
  })

  it('dragMove without an active drag is a no-op', () => {
    const s0 = init({ count: 3 })
    const [s] = update(s0, { type: 'dragMove', x: 70 })
    expect(s).toBe(s0)
  })

  it('swipeDecision: left swap past threshold -> next', () => {
    const s = { ...init({ count: 3, current: 0 }), dragging: { startX: 100, deltaX: -60 } }
    expect(swipeDecision(s)).toBe('next')
  })

  it('swipeDecision: right swipe past threshold -> prev', () => {
    const s = { ...init({ count: 3, current: 1 }), dragging: { startX: 100, deltaX: 60 } }
    expect(swipeDecision(s)).toBe('prev')
  })

  it('swipeDecision: under threshold snaps back', () => {
    const s = { ...init({ count: 3, current: 1 }), dragging: { startX: 100, deltaX: -10 } }
    expect(swipeDecision(s)).toBe('snap')
  })

  it('swipeDecision: respects custom swipeThreshold', () => {
    const s = {
      ...init({ count: 3, current: 0, swipeThreshold: 100 }),
      dragging: { startX: 100, deltaX: -60 },
    }
    expect(swipeDecision(s)).toBe('snap')
  })

  it('swipeDecision: no drag -> snap', () => {
    expect(swipeDecision(init({ count: 3 }))).toBe('snap')
  })

  it('swipeDecision: at last slide without loop, next swipe snaps back', () => {
    const s = {
      ...init({ count: 3, current: 2, loop: false }),
      dragging: { startX: 100, deltaX: -60 },
    }
    expect(swipeDecision(s)).toBe('snap')
  })

  it('swipeDecision: at first slide without loop, prev swipe snaps back', () => {
    const s = {
      ...init({ count: 3, current: 0, loop: false }),
      dragging: { startX: 100, deltaX: 60 },
    }
    expect(swipeDecision(s)).toBe('snap')
  })

  it('swipeDecision: at last slide with loop, next swipe wraps', () => {
    const s = {
      ...init({ count: 3, current: 2, loop: true }),
      dragging: { startX: 100, deltaX: -60 },
    }
    expect(swipeDecision(s)).toBe('next')
  })

  it('dragEnd commits to next past threshold and clears drag', () => {
    const s0 = { ...init({ count: 3, current: 0 }), dragging: { startX: 100, deltaX: -60 } }
    const [s] = update(s0, { type: 'dragEnd' })
    expect(s.current).toBe(1)
    expect(s.dragging).toBeNull()
    expect(s.direction).toBe('forward')
  })

  it('dragEnd commits to prev past threshold and clears drag', () => {
    const s0 = { ...init({ count: 3, current: 2 }), dragging: { startX: 100, deltaX: 60 } }
    const [s] = update(s0, { type: 'dragEnd' })
    expect(s.current).toBe(1)
    expect(s.dragging).toBeNull()
    expect(s.direction).toBe('backward')
  })

  it('dragEnd under threshold snaps back without moving', () => {
    const s0 = { ...init({ count: 3, current: 1 }), dragging: { startX: 100, deltaX: -10 } }
    const [s] = update(s0, { type: 'dragEnd' })
    expect(s.current).toBe(1)
    expect(s.dragging).toBeNull()
  })

  it('dragEnd at loop edge wraps', () => {
    const s0 = {
      ...init({ count: 3, current: 2, loop: true }),
      dragging: { startX: 100, deltaX: -60 },
    }
    const [s] = update(s0, { type: 'dragEnd' })
    expect(s.current).toBe(0)
  })

  it('dragEnd at end without loop snaps back', () => {
    const s0 = {
      ...init({ count: 3, current: 2, loop: false }),
      dragging: { startX: 100, deltaX: -60 },
    }
    const [s] = update(s0, { type: 'dragEnd' })
    expect(s.current).toBe(2)
    expect(s.dragging).toBeNull()
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
  const p = connect(rootSignal(), vi.fn(), { id: 'c1' })

  it('root pointerEnter sends pause', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.root.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).toHaveBeenCalledWith({ type: 'pause' })
  })

  it('nextTrigger disabled when cannot go next', () => {
    expect(read(p.nextTrigger.disabled, init({ count: 3, current: 2, loop: false }))).toBe(true)
    expect(read(p.nextTrigger.disabled, init({ count: 3, current: 2, loop: true }))).toBe(false)
  })

  it('slide hidden when not active', () => {
    const slide1 = p.slide(1).slide
    expect(read(slide1.hidden, init({ count: 3, current: 1 }))).toBe(false)
    expect(read(slide1.hidden, init({ count: 3, current: 0 }))).toBe(true)
  })

  it('indicator click goes to slide', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.slide(2).indicator.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 2 })
  })

  it('slide aria-controls matches id', () => {
    expect(p.slide(0).indicator['aria-controls']).toBe('c1:slide:0')
    expect(p.slide(0).slide.id).toBe('c1:slide:0')
  })

  it('viewport exposes data-dragging while a drag is active', () => {
    expect(
      read(p.viewport['data-dragging'], { ...init(), dragging: { startX: 0, deltaX: 5 } }),
    ).toBe('')
    expect(read(p.viewport['data-dragging'], init())).toBeUndefined()
  })

  it('viewport pointerdown starts a drag', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.viewport.onPointerDown(new PointerEvent('pointerdown', { clientX: 42 }))
    expect(send).toHaveBeenCalledWith({ type: 'dragStart', x: 42 })
  })

  it('viewport pointermove dispatches dragMove only while dragging', () => {
    const send = vi.fn()
    const pc = connect(signalOf({ ...init(), dragging: { startX: 0, deltaX: 0 } }), send, {
      id: 'x',
    })
    pc.viewport.onPointerMove(new PointerEvent('pointermove', { clientX: 30 }))
    expect(send).toHaveBeenCalledWith({ type: 'dragMove', x: 30 })
  })

  it('viewport pointermove is inert when not dragging', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send, { id: 'x' })
    pc.viewport.onPointerMove(new PointerEvent('pointermove', { clientX: 30 }))
    expect(send).not.toHaveBeenCalled()
  })

  it('viewport pointerup ends the drag', () => {
    const send = vi.fn()
    const pc = connect(signalOf({ ...init(), dragging: { startX: 0, deltaX: 0 } }), send, {
      id: 'x',
    })
    pc.viewport.onPointerUp(new PointerEvent('pointerup'))
    expect(send).toHaveBeenCalledWith({ type: 'dragEnd' })
  })

  it('root data-paused is set while dragging even without explicit pause', () => {
    expect(read(p.root['data-paused'], { ...init(), dragging: { startX: 0, deltaX: 1 } })).toBe('')
  })

  it('indicator ArrowRight focuses next slide', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 0 })), send, { id: 'x' })
    pc.slide(0).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 1 })
  })

  it('indicator ArrowLeft focuses previous slide', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 1 })), send, { id: 'x' })
    pc.slide(1).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 0 })
  })

  it('indicator Home jumps to first slide', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 2 })), send, { id: 'x' })
    pc.slide(2).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'Home' }))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 0 })
  })

  it('indicator End jumps to last slide', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 0 })), send, { id: 'x' })
    pc.slide(0).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'End' }))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 2 })
  })

  it('rtl: indicator ArrowRight focuses PREVIOUS slide', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 1, dir: 'rtl' })), send, { id: 'x' })
    pc.slide(1).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 0 })
  })

  it('rtl: indicator ArrowLeft focuses NEXT slide', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 0, dir: 'rtl' })), send, { id: 'x' })
    pc.slide(0).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).toHaveBeenCalledWith({ type: 'goTo', index: 1 })
  })

  it('rtl: Home/End are NOT flipped (Home → first, End → last)', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ count: 3, current: 1, dir: 'rtl' })), send, { id: 'x' })
    pc.slide(1).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'Home' }))
    pc.slide(1).indicator.onKeyDown(new KeyboardEvent('keydown', { key: 'End' }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'goTo', index: 0 })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'goTo', index: 2 })
  })
})
