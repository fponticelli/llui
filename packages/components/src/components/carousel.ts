import type { Send, Signal } from '@llui/dom/signals'
import { useContext, tagSend } from '@llui/dom/signals'
import { LocaleContext, en } from '../locale.js'

/**
 * Carousel — sliding content viewer with pagination. Tracks active slide
 * index, optional autoplay with pause-on-hover, and wraparound navigation.
 */

export interface CarouselState {
  current: number
  count: number
  loop: boolean
  autoplay: boolean
  interval: number
  paused: boolean
  /** Direction of the last transition — useful for entry animations. */
  direction: 'forward' | 'backward'
}

export type CarouselMsg =
  /** @intent("Jump to a specific slide by zero-based index") */
  | { type: 'goTo'; index: number }
  /** @intent("Advance to the next slide (wraps if loop is enabled)") */
  | { type: 'next' }
  /** @intent("Go back to the previous slide (wraps if loop is enabled)") */
  | { type: 'prev' }
  /** @humanOnly */
  | { type: 'setCount'; count: number }
  /** @intent("Pause autoplay (typically while user hovers or focuses the carousel)") */
  | { type: 'pause' }
  /** @intent("Resume autoplay after a pause") */
  | { type: 'resume' }
  /** @intent("Turn autoplay on or off") */
  | { type: 'setAutoplay'; autoplay: boolean }

export interface CarouselInit {
  current?: number
  count?: number
  loop?: boolean
  autoplay?: boolean
  interval?: number
}

export function init(opts: CarouselInit = {}): CarouselState {
  return {
    current: opts.current ?? 0,
    count: opts.count ?? 0,
    loop: opts.loop ?? true,
    autoplay: opts.autoplay ?? false,
    interval: opts.interval ?? 5000,
    paused: false,
    direction: 'forward',
  }
}

function clampIndex(state: CarouselState, next: number): number {
  if (state.count === 0) return 0
  if (state.loop) return ((next % state.count) + state.count) % state.count
  return Math.max(0, Math.min(state.count - 1, next))
}

export function update(state: CarouselState, msg: CarouselMsg): [CarouselState, never[]] {
  switch (msg.type) {
    case 'goTo': {
      const next = clampIndex(state, msg.index)
      return [
        { ...state, current: next, direction: next >= state.current ? 'forward' : 'backward' },
        [],
      ]
    }
    case 'next': {
      const next = clampIndex(state, state.current + 1)
      return [{ ...state, current: next, direction: 'forward' }, []]
    }
    case 'prev': {
      const prev = clampIndex(state, state.current - 1)
      return [{ ...state, current: prev, direction: 'backward' }, []]
    }
    case 'setCount': {
      const current = Math.min(state.current, Math.max(0, msg.count - 1))
      return [{ ...state, count: msg.count, current }, []]
    }
    case 'pause':
      return [{ ...state, paused: true }, []]
    case 'resume':
      return [{ ...state, paused: false }, []]
    case 'setAutoplay':
      return [{ ...state, autoplay: msg.autoplay }, []]
  }
}

export function canGoNext(state: CarouselState): boolean {
  if (state.loop) return state.count > 0
  return state.current < state.count - 1
}

export function canGoPrev(state: CarouselState): boolean {
  if (state.loop) return state.count > 0
  return state.current > 0
}

export interface CarouselSlideParts {
  slide: {
    role: 'tabpanel'
    id: string
    'aria-roledescription': 'slide'
    'aria-label': string
    'data-scope': 'carousel'
    'data-part': 'slide'
    'data-index': string
    'data-active': Signal<'' | undefined>
    hidden: Signal<boolean>
  }
  indicator: {
    type: 'button'
    role: 'tab'
    'aria-label': string
    'aria-selected': Signal<boolean>
    'aria-controls': string
    'data-scope': 'carousel'
    'data-part': 'indicator'
    'data-index': string
    'data-active': Signal<'' | undefined>
    onClick: (e: MouseEvent) => void
  }
}

export interface CarouselParts {
  root: {
    role: 'region'
    'aria-roledescription': 'carousel'
    'aria-label': string
    'data-scope': 'carousel'
    'data-part': 'root'
    'data-paused': Signal<'' | undefined>
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
  }
  viewport: {
    'data-scope': 'carousel'
    'data-part': 'viewport'
  }
  indicatorGroup: {
    role: 'tablist'
    'aria-label': string
    'data-scope': 'carousel'
    'data-part': 'indicator-group'
  }
  nextTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'carousel'
    'data-part': 'next-trigger'
    onClick: (e: MouseEvent) => void
  }
  prevTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'carousel'
    'data-part': 'prev-trigger'
    onClick: (e: MouseEvent) => void
  }
  slide: (index: number) => CarouselSlideParts
}

export interface ConnectOptions {
  id: string
  label?: string
  indicatorLabel?: string
  nextLabel?: string
  prevLabel?: string
  /** Builder for each slide's aria-label. Receives index + known count. */
  slideLabel?: (index: number, count: number) => string
}

export function connect(
  state: Signal<CarouselState>,
  send: Send<CarouselMsg>,
  opts: ConnectOptions,
): CarouselParts {
  const locale = useContext(LocaleContext)
  const label = opts.label ?? locale.carousel.label
  const indicatorLabel = opts.indicatorLabel ?? locale.carousel.indicators
  const nextLabel = opts.nextLabel ?? locale.carousel.next
  const prevLabel = opts.prevLabel ?? locale.carousel.prev
  const slideLabelFn = opts.slideLabel ?? en.carousel.slide
  const slideId = (i: number): string => `${opts.id}:slide:${i}`

  return {
    root: {
      role: 'region',
      'aria-roledescription': 'carousel',
      'aria-label': label,
      'data-scope': 'carousel',
      'data-part': 'root',
      'data-paused': state.map((s) => (s.paused ? '' : undefined)),
      onPointerEnter: tagSend(send, ['pause'], () => send({ type: 'pause' })),
      onPointerLeave: tagSend(send, ['resume'], () => send({ type: 'resume' })),
      onFocus: tagSend(send, ['pause'], () => send({ type: 'pause' })),
      onBlur: tagSend(send, ['resume'], () => send({ type: 'resume' })),
    },
    viewport: {
      'data-scope': 'carousel',
      'data-part': 'viewport',
    },
    indicatorGroup: {
      role: 'tablist',
      'aria-label': indicatorLabel,
      'data-scope': 'carousel',
      'data-part': 'indicator-group',
    },
    nextTrigger: {
      type: 'button',
      'aria-label': nextLabel,
      disabled: state.map((s) => !canGoNext(s)),
      'data-scope': 'carousel',
      'data-part': 'next-trigger',
      onClick: tagSend(send, ['next'], () => send({ type: 'next' })),
    },
    prevTrigger: {
      type: 'button',
      'aria-label': prevLabel,
      disabled: state.map((s) => !canGoPrev(s)),
      'data-scope': 'carousel',
      'data-part': 'prev-trigger',
      onClick: tagSend(send, ['prev'], () => send({ type: 'prev' })),
    },
    slide: (index: number): CarouselSlideParts => ({
      slide: {
        role: 'tabpanel',
        id: slideId(index),
        'aria-roledescription': 'slide',
        'aria-label': slideLabelFn(index, 0),
        'data-scope': 'carousel',
        'data-part': 'slide',
        'data-index': String(index),
        'data-active': state.map((s) => (s.current === index ? '' : undefined)),
        hidden: state.map((s) => s.current !== index),
      },
      indicator: {
        type: 'button',
        role: 'tab',
        'aria-label': en.carousel.goToSlide(index),
        'aria-selected': state.map((s) => s.current === index),
        'aria-controls': slideId(index),
        'data-scope': 'carousel',
        'data-part': 'indicator',
        'data-index': String(index),
        'data-active': state.map((s) => (s.current === index ? '' : undefined)),
        onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', index })),
      },
    }),
  }
}

export const carousel = { init, update, connect, canGoNext, canGoPrev }
