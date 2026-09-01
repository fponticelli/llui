import { afterEach, describe, expect, it } from 'vitest'
import { component, mountApp, text, type Mountable } from '@llui/dom'
import * as carousel from '@llui/components/carousel'
import {
  Carousel,
  CarouselContent,
  CarouselIndicator,
  CarouselIndicatorGroup,
  CarouselNext,
  CarouselPrevious,
  CarouselSlide,
  CarouselViewport,
} from '../llui/ui/carousel'

const SLIDES = ['One', 'Two', 'Three']
let app: ReturnType<typeof mountApp> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

function mount(dir: 'ltr' | 'rtl' = 'ltr'): HTMLElement {
  const host = document.createElement('div')
  host.dir = dir
  document.body.append(host)
  const definition = component<{ carousel: carousel.CarouselState }, carousel.CarouselMsg>({
    name: 'RegistryCarouselMachine',
    init: () => [{ carousel: carousel.init({ count: SLIDES.length, dir }) }, []],
    update: (state, msg) => [{ carousel: carousel.update(state.carousel, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = carousel.connect(state.at('carousel'), send, { id: 'registry-carousel' })
      return [
        Carousel({ ...parts.root }, [
          CarouselViewport({ ...parts.viewport }, [
            CarouselContent(
              { ...parts.track },
              SLIDES.map((label, index) =>
                CarouselSlide({ ...parts.slide(index).slide }, [text(label)]),
              ),
            ),
          ]),
          CarouselPrevious({ ...parts.prevTrigger }),
          CarouselNext({ ...parts.nextTrigger }),
          CarouselIndicatorGroup(
            { ...parts.indicatorGroup },
            SLIDES.map((_label, index) => CarouselIndicator({ ...parts.slide(index).indicator })),
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

describe('registry carousel consumes the live machine contract', () => {
  it.each([
    ['ltr', 'ArrowRight', 1],
    ['rtl', 'ArrowLeft', 1],
    ['ltr', 'End', 2],
    ['rtl', 'Home', 0],
  ] as const)('moves selection, tab stop, and actual focus in %s with %s', (dir, key, next) => {
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
  })

  it('publishes the live pointer offset on the skinned viewport and clears it after release', () => {
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
    expect(host.querySelector('[data-part="track"]')).not.toBeNull()
    pointer('pointerup', 40)
    expect(viewport.style.getPropertyValue('--carousel-drag-offset')).toBe('')
    expect(indicator(host, 1).getAttribute('aria-selected')).toBe('true')
  })
})
