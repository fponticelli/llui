import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { flipArrow } from '../utils/direction.js'

/**
 * Carousel — sliding content viewer with pagination. Tracks active slide
 * index, optional autoplay with pause-on-hover, wraparound navigation,
 * pointer-swipe gestures (threshold commit / snap-back, autoplay paused
 * while dragging), and APG-tabs keyboard navigation on the indicator list.
 *
 * Swipe is pure: the viewport wires pointerdown/move/up and feeds raw client
 * X coordinates to the machine; `swipeDecision()` resolves commit-vs-snap and
 * `update` applies it on `dragEnd`. No event listeners live in the machine.
 */

/**
 * Live pointer-swipe state. JSON-serializable: just the start X and the
 * accumulated horizontal delta (positive = dragged right, negative = left).
 * The view supplies pointer coordinates; the machine does pure math.
 */
export interface CarouselDrag {
  startX: number
  deltaX: number
}

export interface CarouselState {
  current: number
  count: number
  loop: boolean
  autoplay: boolean
  interval: number
  paused: boolean
  /** Direction of the last transition — useful for entry animations. */
  direction: 'forward' | 'backward'
  /**
   * Minimum absolute horizontal distance (px) a swipe must cross to commit
   * to the previous/next slide. Below this the drag snaps back.
   */
  swipeThreshold: number
  /** Active pointer swipe, or null when idle. */
  dragging: CarouselDrag | null
  /** Reading direction. Under 'rtl' indicator horizontal arrow keys are flipped. */
  dir: 'ltr' | 'rtl'
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
  /** @humanOnly */
  | { type: 'dragStart'; x: number }
  /** @humanOnly */
  | { type: 'dragMove'; x: number }
  /** @humanOnly */
  | { type: 'dragEnd' }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }

export interface CarouselInit {
  current?: number
  count?: number
  loop?: boolean
  autoplay?: boolean
  interval?: number
  swipeThreshold?: number
  dir?: 'ltr' | 'rtl'
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
    swipeThreshold: opts.swipeThreshold ?? 50,
    dragging: null,
    dir: opts.dir ?? 'ltr',
  }
}

function clampIndex(state: CarouselState, next: number): number {
  if (state.count === 0) return 0
  if (state.loop) return ((next % state.count) + state.count) % state.count
  return Math.max(0, Math.min(state.count - 1, next))
}

/**
 * Pure swipe resolver. Given a state with an active drag, decide whether the
 * gesture commits to the previous/next slide or snaps back to the current one.
 *
 *   - A leftward swipe (deltaX < 0) that crosses `swipeThreshold` targets
 *     the NEXT slide; a rightward swipe (deltaX > 0) targets the PREVIOUS.
 *   - Below the threshold, or with no active drag, it snaps back.
 *   - At a non-loop boundary the target direction is unavailable, so it
 *     snaps back. With loop enabled the move always commits (wraps).
 */
export function swipeDecision(state: CarouselState): 'prev' | 'next' | 'snap' {
  const d = state.dragging
  if (!d) return 'snap'
  if (Math.abs(d.deltaX) < state.swipeThreshold) return 'snap'
  if (d.deltaX < 0) return canGoNext(state) ? 'next' : 'snap'
  return canGoPrev(state) ? 'prev' : 'snap'
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
    case 'dragStart':
      return [{ ...state, dragging: { startX: msg.x, deltaX: 0 } }, []]
    case 'dragMove': {
      if (!state.dragging) return [state, []]
      const deltaX = msg.x - state.dragging.startX
      if (deltaX === state.dragging.deltaX) return [state, []]
      return [{ ...state, dragging: { ...state.dragging, deltaX } }, []]
    }
    case 'dragEnd': {
      if (!state.dragging) return [state, []]
      const decision = swipeDecision(state)
      if (decision === 'next') {
        const next = clampIndex(state, state.current + 1)
        return [{ ...state, current: next, direction: 'forward', dragging: null }, []]
      }
      if (decision === 'prev') {
        const prev = clampIndex(state, state.current - 1)
        return [{ ...state, current: prev, direction: 'backward', dragging: null }, []]
      }
      return [{ ...state, dragging: null }, []]
    }
    case 'setDir':
      return [{ ...state, dir: msg.dir }, []]
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
    onKeyDown: (e: KeyboardEvent) => void
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
    /**
     * Set while a pointer swipe is in flight — consumers gate the slide-track
     * transition off (`[data-dragging] { transition: none }`) so the track
     * follows the finger 1:1 instead of easing.
     */
    'data-dragging': Signal<'' | undefined>
    /** Live track offset (px) to follow the finger: `translateX(var)`. */
    'data-drag-offset': Signal<string | undefined>
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
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
  const slideLabelFn = opts.slideLabel ?? locale.carousel.slide
  const slideId = (i: number): string => `${opts.id}:slide:${i}`

  return {
    root: {
      role: 'region',
      'aria-roledescription': 'carousel',
      'aria-label': label,
      'data-scope': 'carousel',
      'data-part': 'root',
      // Autoplay is suppressed both on explicit pause AND while a swipe is in
      // flight, so the slide doesn't advance out from under the user's finger.
      'data-paused': state.map((s) => (s.paused || s.dragging !== null ? '' : undefined)),
      onPointerEnter: tagSend(send, ['pause'], () => send({ type: 'pause' })),
      onPointerLeave: tagSend(send, ['resume'], () => send({ type: 'resume' })),
      onFocus: tagSend(send, ['pause'], () => send({ type: 'pause' })),
      onBlur: tagSend(send, ['resume'], () => send({ type: 'resume' })),
    },
    viewport: {
      'data-scope': 'carousel',
      'data-part': 'viewport',
      'data-dragging': state.map((s) => (s.dragging !== null ? '' : undefined)),
      'data-drag-offset': state.map((s) =>
        s.dragging !== null ? `${s.dragging.deltaX}px` : undefined,
      ),
      onPointerDown: tagSend(send, ['dragStart'], (e) => {
        // Only the primary button / single-finger touch drives a swipe.
        if (e.button !== 0) return
        const target = e.currentTarget as Element | null
        if (target && 'setPointerCapture' in target) {
          try {
            ;(target as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(
              e.pointerId,
            )
          } catch {
            // Ignore — not all elements support pointer capture
          }
        }
        send({ type: 'dragStart', x: e.clientX })
      }),
      onPointerMove: tagSend(send, ['dragMove'], (e) => {
        if (state.peek().dragging === null) return
        send({ type: 'dragMove', x: e.clientX })
      }),
      onPointerUp: tagSend(send, ['dragEnd'], () => {
        if (state.peek().dragging === null) return
        send({ type: 'dragEnd' })
      }),
      onPointerCancel: tagSend(send, ['dragEnd'], () => {
        if (state.peek().dragging === null) return
        send({ type: 'dragEnd' })
      }),
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
        'aria-label': locale.carousel.goToSlide(index),
        'aria-selected': state.map((s) => s.current === index),
        'aria-controls': slideId(index),
        'data-scope': 'carousel',
        'data-part': 'indicator',
        'data-index': String(index),
        'data-active': state.map((s) => (s.current === index ? '' : undefined)),
        onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', index })),
        // APG tabs keyboard model on the indicator tablist. ArrowRight/ArrowLeft
        // move to the adjacent indicator (wrapping when loop is enabled, clamped
        // otherwise); Home/End jump to the first/last slide. Horizontal arrows
        // flip under rtl via `flipArrow`; Home/End are never flipped.
        onKeyDown: tagSend(send, ['goTo'], (e: KeyboardEvent) => {
          const s = state.peek()
          if (s.count === 0) return
          const key = flipArrow(e.key, s.dir)
          switch (key) {
            case 'ArrowRight': {
              e.preventDefault()
              send({ type: 'goTo', index: clampIndex(s, index + 1) })
              return
            }
            case 'ArrowLeft': {
              e.preventDefault()
              send({ type: 'goTo', index: clampIndex(s, index - 1) })
              return
            }
            case 'Home': {
              e.preventDefault()
              send({ type: 'goTo', index: 0 })
              return
            }
            case 'End': {
              e.preventDefault()
              send({ type: 'goTo', index: s.count - 1 })
              return
            }
          }
        }),
      },
    }),
  }
}

export const carousel = { init, update, connect, canGoNext, canGoPrev, swipeDecision }
