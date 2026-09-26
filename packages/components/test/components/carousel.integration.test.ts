import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, component, div, mountApp, text, type Mountable } from '@llui/dom'
import * as carousel from '../../src/components/carousel'

const SLIDES = ['One', 'Two', 'Three']
let app: ReturnType<typeof mountApp> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

function mount(dir: 'ltr' | 'rtl' = 'ltr', machineDir?: 'ltr' | 'rtl'): HTMLElement {
  const host = document.createElement('div')
  host.dir = dir
  document.body.append(host)
  const definition = component<{ carousel: carousel.CarouselState }, carousel.CarouselMsg>({
    name: 'BaselineCarouselMachine',
    init: () => [
      {
        carousel: carousel.init({
          count: SLIDES.length,
          ...(machineDir === undefined ? {} : { dir: machineDir }),
        }),
      },
      [],
    ],
    update: (state, msg) => [{ carousel: carousel.update(state.carousel, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = carousel.connect(state.at('carousel'), send, { id: 'baseline-carousel' })
      return [
        div({ ...parts.root }, [
          parts.directionSync,
          div({ ...parts.viewport }, [
            div(
              { ...parts.track },
              SLIDES.map((label, index) => div({ ...parts.slide(index).slide }, [text(label)])),
            ),
          ]),
          button({ ...parts.prevTrigger }, [text('Previous')]),
          button({ ...parts.nextTrigger }, [text('Next')]),
          div(
            { ...parts.indicatorGroup },
            SLIDES.map((_label, index) => button({ ...parts.slide(index).indicator })),
          ),
        ]),
      ]
    },
  })
  app = mountApp(host, definition)
  return host
}

const indicator = (host: HTMLElement, index: number): HTMLButtonElement =>
  host.querySelector(`[data-part="indicator"][data-index="${index}"]`) as HTMLButtonElement

describe('baseline carousel live DOM contract', () => {
  it.each([
    ['ltr', 'ArrowRight', 1],
    ['rtl', 'ArrowLeft', 1],
    ['ltr', 'End', 2],
    ['rtl', 'Home', 0],
  ] as const)(
    'moves selection, roving tab stop, and real focus in %s with %s',
    (dir, key, next) => {
      const host = mount(dir)
      indicator(host, 0).focus()
      indicator(host, 0).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )

      const indicators = [...host.querySelectorAll<HTMLButtonElement>('[data-part="indicator"]')]
      expect(document.activeElement).toBe(indicator(host, next))
      expect(indicators.filter((item) => item.tabIndex === 0)).toEqual([indicator(host, next)])
      expect(indicators.filter((item) => item.getAttribute('aria-selected') === 'true')).toEqual([
        indicator(host, next),
      ])
    },
  )

  it('publishes live pointer offset mid-drag and clears it on commit and snap', () => {
    const host = mount()
    const viewport = host.querySelector('[data-part="viewport"]') as HTMLElement
    const pointer = (type: string, clientX: number) =>
      viewport.dispatchEvent(
        new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true }),
      )

    pointer('pointerdown', 100)
    pointer('pointermove', 40)
    expect(viewport.dataset['dragging']).toBe('')
    expect(viewport.style.getPropertyValue('--carousel-drag-offset')).toBe('-60px')
    pointer('pointerup', 40)
    expect(viewport.hasAttribute('data-dragging')).toBe(false)
    expect(viewport.style.getPropertyValue('--carousel-drag-offset')).toBe('')
    expect(indicator(host, 1).getAttribute('aria-selected')).toBe('true')

    pointer('pointerdown', 100)
    pointer('pointermove', 80)
    expect(viewport.style.getPropertyValue('--carousel-drag-offset')).toBe('-20px')
    pointer('pointerup', 80)
    expect(viewport.style.getPropertyValue('--carousel-drag-offset')).toBe('')
    expect(indicator(host, 1).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps explicit machine direction authoritative over the carousel DOM', () => {
    const host = mount('rtl', 'ltr')
    indicator(host, 0).focus()
    indicator(host, 0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    )

    expect(document.activeElement).toBe(indicator(host, 2))
    expect(indicator(host, 2).getAttribute('aria-selected')).toBe('true')
  })
})

// Indicators carry only `data-scope`/`data-part`/`data-index` — nothing
// identifies WHICH carousel instance they belong to unless the search that
// resolves keyboard-driven focus is scoped to this carousel's own DOM subtree.
// A skin that renders its dot navigation without spreading `parts.indicatorGroup`
// (e.g. a custom container styled by hand) removes the one ancestor the old
// scoping relied on; `focusIndicator` used to fall back to searching the WHOLE
// document in that case, so two such carousels sharing a page could steal
// keyboard focus into each other's indicators.
function mountBareIndicators(id: string, host: HTMLElement): ReturnType<typeof mountApp> {
  const definition = component<{ carousel: carousel.CarouselState }, carousel.CarouselMsg>({
    name: 'BareIndicatorCarouselMachine',
    init: () => [{ carousel: carousel.init({ count: SLIDES.length }) }, []],
    update: (state, msg) => [{ carousel: carousel.update(state.carousel, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = carousel.connect(state.at('carousel'), send, { id })
      return SLIDES.map((_label, index) => button({ ...parts.slide(index).indicator }))
    },
  })
  return mountApp(host, definition)
}

describe('carousel keyboard focus stays scoped to its own instance', () => {
  it('never lets a bare (unwrapped) indicator set steal focus into a different carousel', () => {
    const hostA = document.createElement('div')
    const hostB = document.createElement('div')
    document.body.append(hostA, hostB)
    const appA = mountBareIndicators('bare-carousel-a', hostA)
    const appB = mountBareIndicators('bare-carousel-b', hostB)

    const indicatorsA = [...hostA.querySelectorAll<HTMLButtonElement>('[data-part="indicator"]')]
    const indicatorsB = [...hostB.querySelectorAll<HTMLButtonElement>('[data-part="indicator"]')]

    // Carousel A is earlier in document order, so a whole-document search for
    // `[data-index="1"]` finds A's button first — pressing ArrowRight on B's
    // OWN indicator must never move focus there.
    indicatorsB[0].focus()
    indicatorsB[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    )

    expect(indicatorsB[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).not.toBe(indicatorsA[1])
    expect(indicatorsA.includes(document.activeElement as HTMLButtonElement)).toBe(false)

    appA.dispose()
    appB.dispose()
    hostA.remove()
    hostB.remove()
  })
})

interface AutoplayState {
  carousel: carousel.CarouselState
}

describe('carousel mounted autoplay contract', () => {
  let autoplayApp: ReturnType<
    typeof mountApp<AutoplayState, carousel.CarouselMsg, carousel.CarouselEffect>
  > | null = null

  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    autoplayApp?.dispose()
    autoplayApp = null
    vi.useRealTimers()
  })

  function mountAutoplay(opts: carousel.CarouselInit): {
    readonly root: HTMLElement
    readonly focusTarget: HTMLButtonElement
    readonly outside: HTMLButtonElement
    readonly send: (msg: carousel.CarouselMsg) => void
    readonly current: () => number
    readonly state: () => carousel.CarouselState
    readonly timerCount: () => number
    readonly timerActive: () => boolean
    readonly effects: () => readonly carousel.CarouselEffect['type'][]
  } {
    let sendRef!: (msg: carousel.CarouselMsg) => void
    let timerId: ReturnType<typeof setInterval> | null = null
    const effects: carousel.CarouselEffect['type'][] = []
    const stop = (): void => {
      if (timerId !== null) clearInterval(timerId)
      timerId = null
    }
    const definition = component<AutoplayState, carousel.CarouselMsg, carousel.CarouselEffect>({
      name: 'MountedCarouselAutoplay',
      init: () => {
        const state = carousel.init(opts)
        return [{ carousel: state }, carousel.autoplayEffects(state)]
      },
      update: (state, msg) => {
        const [carouselState, effects] = carousel.update(state.carousel, msg)
        return [{ carousel: carouselState }, effects]
      },
      onEffect: (effect, { send }) => {
        effects.push(effect.type)
        if (effect.type === 'stopAutoplay') {
          stop()
          return
        }
        stop()
        timerId = setInterval(() => send({ type: 'autoplayTick' }), effect.interval)
        return stop
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = carousel.connect(state.at('carousel'), send, { id: 'autoplay-carousel' })
        return [
          div({ ...parts.root }, [
            parts.directionSync,
            button({ ...parts.nextTrigger, id: 'autoplay-focus-target' }, [text('Next')]),
          ]),
          button({ id: 'autoplay-outside' }, [text('Outside')]),
        ]
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    autoplayApp = mountApp(host, definition)
    return {
      root: host.querySelector('#autoplay-carousel')!,
      focusTarget: host.querySelector('#autoplay-focus-target')!,
      outside: host.querySelector('#autoplay-outside')!,
      send: (msg) => sendRef(msg),
      current: () => autoplayApp!.getState().carousel.current,
      state: () => autoplayApp!.getState().carousel,
      timerCount: () => vi.getTimerCount(),
      timerActive: () => timerId !== null,
      effects: () => effects,
    }
  }

  it('advances on the configured interval', () => {
    const mounted = mountAutoplay({ count: 3, autoplay: true, interval: 1000 })
    vi.advanceTimersByTime(1000)
    expect(mounted.current()).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(mounted.current()).toBe(0)
  })

  it('does not schedule when autoplay is off', () => {
    const mounted = mountAutoplay({ count: 3, interval: 1000 })
    vi.advanceTimersByTime(5000)
    expect(mounted.current()).toBe(0)
  })

  it('pauses and resumes the mounted timer', () => {
    const mounted = mountAutoplay({ count: 3, autoplay: true, interval: 1000 })
    mounted.send({ type: 'pause' })
    expect(mounted.timerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(mounted.current()).toBe(0)
    mounted.send({ type: 'resume' })
    vi.advanceTimersByTime(1000)
    expect(mounted.current()).toBe(1)
  })

  it('replaces the timer when manual navigation restarts its period', () => {
    const mounted = mountAutoplay({ count: 5, autoplay: true, interval: 1000 })
    vi.advanceTimersByTime(600)
    mounted.send({ type: 'next' })
    vi.advanceTimersByTime(400)
    expect(mounted.current()).toBe(1)
    vi.advanceTimersByTime(600)
    expect(mounted.current()).toBe(2)
    expect(mounted.timerCount()).toBe(1)
  })

  it('leaves no timer after dispose', () => {
    const mounted = mountAutoplay({ count: 3, autoplay: true, interval: 1000 })
    expect(mounted.timerCount()).toBe(1)
    autoplayApp!.dispose()
    autoplayApp = null
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not resume until both hover and focus-within have cleared', () => {
    const mounted = mountAutoplay({ count: 3, autoplay: true, interval: 1000 })
    mounted.root.dispatchEvent(new PointerEvent('pointerenter'))
    mounted.focusTarget.focus()
    expect(mounted.state()).toMatchObject({ hovered: true, focusWithin: true })
    expect(mounted.effects()).toContain('stopAutoplay')
    expect(mounted.timerActive()).toBe(false)

    mounted.root.dispatchEvent(new PointerEvent('pointerleave'))
    expect(mounted.timerActive()).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(mounted.current()).toBe(0)

    mounted.outside.focus()
    expect(mounted.timerActive()).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(mounted.current()).toBe(1)
  })
})
