import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { component, mountApp, div, button } from '@llui/dom'
import type { SignalComponentHandle } from '@llui/dom'
import {
  carousel,
  type CarouselState,
  type CarouselMsg,
  type CarouselEffect,
} from '../../src/components/carousel'

type S = { c: CarouselState }

/**
 * The machine emits `startAutoplay`/`stopAutoplay`; the host owns the timer.
 * This is the wiring the docs describe, done with a bare `setInterval` so the
 * test proves the CONTRACT (advance, pause, restart, and nothing surviving
 * dispose) without pulling `@llui/effects` into this package (#127).
 */
describe('carousel autoplay integration', () => {
  let app: SignalComponentHandle<S, CarouselMsg> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  function mount(opts: Parameters<typeof carousel.init>[0]) {
    let sendRef!: (m: CarouselMsg) => void
    let timerId: ReturnType<typeof setInterval> | null = null
    const stop = (): void => {
      if (timerId !== null) clearInterval(timerId)
      timerId = null
    }
    const def = component<S, CarouselMsg, CarouselEffect>({
      name: 'C',
      init: () => {
        const c = carousel.init(opts)
        return [{ c }, carousel.autoplayEffects(c)]
      },
      update: (s, m) => {
        const [c, fx] = carousel.update(s.c, m)
        return [{ c }, fx]
      },
      onEffect: (fx, { send }) => {
        if (fx.type === 'stopAutoplay') {
          stop()
          return
        }
        // A restart replaces the timer already running.
        stop()
        timerId = setInterval(() => send({ type: 'autoplayTick' }), fx.interval)
        // Returned cleanup runs on dispose — this is what kills the timer at unmount.
        return stop
      },
      view: ({ state, send }) => {
        sendRef = send
        const p = carousel.connect(state.at('c'), send, { id: 'car' })
        return [div({ ...p.root }, [button({ ...p.nextTrigger }, [])])]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return {
      send: (m: CarouselMsg) => sendRef(m),
      current: () => app!.getState().c.current,
      timerCount: () => vi.getTimerCount(),
    }
  }

  it('autoplay advances the slide on the configured interval', () => {
    const h = mount({ count: 3, autoplay: true, interval: 1000 })
    expect(h.current()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(h.current()).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(h.current()).toBe(0) // wrapped: 1 → 2 → 0
  })

  it('does not autoplay when autoplay is off', () => {
    const h = mount({ count: 3, interval: 1000 })
    expect(h.timerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(h.current()).toBe(0)
  })

  it('pause stops it and resume restarts it', () => {
    const h = mount({ count: 3, autoplay: true, interval: 1000 })
    h.send({ type: 'pause' })
    expect(h.timerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(h.current()).toBe(0)
    h.send({ type: 'resume' })
    vi.advanceTimersByTime(1000)
    expect(h.current()).toBe(1)
  })

  it('manual navigation restarts the timer rather than double-advancing', () => {
    const h = mount({ count: 5, autoplay: true, interval: 1000 })
    vi.advanceTimersByTime(600)
    h.send({ type: 'next' }) // → 1, timer restarts from here
    expect(h.current()).toBe(1)
    // The 400ms left of the original period must NOT fire a second advance.
    vi.advanceTimersByTime(400)
    expect(h.current()).toBe(1)
    vi.advanceTimersByTime(600)
    expect(h.current()).toBe(2)
    expect(h.timerCount()).toBe(1)
  })

  it('dispose leaves no timer behind', () => {
    const h = mount({ count: 3, autoplay: true, interval: 1000 })
    expect(h.timerCount()).toBe(1)
    app!.dispose()
    app = null
    expect(vi.getTimerCount()).toBe(0)
  })
})
