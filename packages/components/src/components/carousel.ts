import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext, en } from '../locale.js'
import type { Locale } from '../locale.js'

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
  | { type: 'goTo'; index: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'setCount'; count: number }
  | { type: 'pause' }
  | { type: 'resume' }
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

export interface CarouselSlideParts<S> {
  slide: {
    role: 'tabpanel'
    id: string
    'aria-roledescription': 'slide'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'carousel'
    'data-part': 'slide'
    'data-index': string
    'data-active': (s: S) => '' | undefined
    hidden: (s: S) => boolean
  }
  indicator: {
    type: 'button'
    role: 'tab'
    'aria-label': string | ((s: S) => string)
    'aria-selected': (s: S) => boolean
    'aria-controls': string
    'data-scope': 'carousel'
    'data-part': 'indicator'
    'data-index': string
    'data-active': (s: S) => '' | undefined
    onClick: (e: MouseEvent) => void
  }
}

export interface CarouselParts<S> {
  root: {
    role: 'region'
    'aria-roledescription': 'carousel'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'carousel'
    'data-part': 'root'
    'data-paused': (s: S) => '' | undefined
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
    'aria-label': string | ((s: S) => string)
    'data-scope': 'carousel'
    'data-part': 'indicator-group'
  }
  nextTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'carousel'
    'data-part': 'next-trigger'
    onClick: (e: MouseEvent) => void
  }
  prevTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'carousel'
    'data-part': 'prev-trigger'
    onClick: (e: MouseEvent) => void
  }
  slide: (index: number) => CarouselSlideParts<S>
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

export function connect<S>(
  get: (s: S) => CarouselState,
  send: Send<CarouselMsg>,
  opts: ConnectOptions,
): CarouselParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const label: string | ((s: S) => string) = opts.label ?? ((s: S) => locale(s).carousel.label)
  const indicatorLabel: string | ((s: S) => string) =
    opts.indicatorLabel ?? ((s: S) => locale(s).carousel.indicators)
  const nextLabel: string | ((s: S) => string) =
    opts.nextLabel ?? ((s: S) => locale(s).carousel.next)
  const prevLabel: string | ((s: S) => string) =
    opts.prevLabel ?? ((s: S) => locale(s).carousel.prev)
  const slideLabelFn = opts.slideLabel ?? en.carousel.slide
  const slideId = (i: number): string => `${opts.id}:slide:${i}`

  return {
    root: {
      role: 'region',
      'aria-roledescription': 'carousel',
      'aria-label': label,
      'data-scope': 'carousel',
      'data-part': 'root',
      'data-paused': (s) => (get(s).paused ? '' : undefined),
      onPointerEnter: () => send({ type: 'pause' }),
      onPointerLeave: () => send({ type: 'resume' }),
      onFocus: () => send({ type: 'pause' }),
      onBlur: () => send({ type: 'resume' }),
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
      disabled: (s) => !canGoNext(get(s)),
      'data-scope': 'carousel',
      'data-part': 'next-trigger',
      onClick: () => send({ type: 'next' }),
    },
    prevTrigger: {
      type: 'button',
      'aria-label': prevLabel,
      disabled: (s) => !canGoPrev(get(s)),
      'data-scope': 'carousel',
      'data-part': 'prev-trigger',
      onClick: () => send({ type: 'prev' }),
    },
    slide: (index: number): CarouselSlideParts<S> => ({
      slide: {
        role: 'tabpanel',
        id: slideId(index),
        'aria-roledescription': 'slide',
        'aria-label': slideLabelFn(index, 0),
        'data-scope': 'carousel',
        'data-part': 'slide',
        'data-index': String(index),
        'data-active': (s) => (get(s).current === index ? '' : undefined),
        hidden: (s) => get(s).current !== index,
      },
      indicator: {
        type: 'button',
        role: 'tab',
        'aria-label': en.carousel.goToSlide(index),
        'aria-selected': (s) => get(s).current === index,
        'aria-controls': slideId(index),
        'data-scope': 'carousel',
        'data-part': 'indicator',
        'data-index': String(index),
        'data-active': (s) => (get(s).current === index ? '' : undefined),
        onClick: () => send({ type: 'goTo', index }),
      },
    }),
  }
}

export const carousel = { init, update, connect, canGoNext, canGoPrev }
