import type { Mountable, Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { carouselLocale } from '../locale/carousel.js'
import {
  directionSyncMount,
  eventDirection,
  flipArrow,
  initDirection,
  setDirection,
  syncDomDirection,
  type DirectionSource,
} from '../utils/direction.js'
import { allFiniteNumbers, finiteBound, finiteOrDefault } from '../utils/number.js'

/**
 * Carousel — sliding content viewer with pagination. Tracks active slide
 * index, optional autoplay with pause-on-hover, wraparound navigation,
 * pointer-swipe gestures (threshold commit / snap-back, autoplay paused
 * while dragging), and APG-tabs keyboard navigation on the indicator list.
 *
 * Swipe is pure: the viewport wires pointerdown/move/up and feeds raw client
 * X coordinates to the machine; `swipeDecision()` resolves commit-vs-snap and
 * `update` applies it on `dragEnd`. No event listeners live in the machine.
 *
 * Autoplay is effects-as-data, like every other timer in LLui: the machine
 * owns WHEN the timer should run and emits `startAutoplay`/`stopAutoplay`; the
 * consumer owns the timer itself. With `@llui/effects`:
 *
 * ```ts
 * init: () => {
 *   const c = carousel.init({ count: 3, autoplay: true, interval: 4000 })
 *   return [{ c }, carousel.autoplayEffects(c)]
 * },
 * update: (s, m) => {
 *   const [c, fx] = carousel.update(s.c, m)
 *   return [{ c }, fx]
 * },
 * onEffect: asOnEffect(
 *   handleEffects<CarouselEffect>().else((fx) =>
 *     fx.type === 'startAutoplay'
 *       ? interval('carousel', fx.interval, { type: 'autoplayTick' })
 *       : cancel('carousel'),
 *   ),
 * )
 * ```
 *
 * `interval` re-registers under the same key, so a restart replaces the timer
 * in flight; `cancel` retires it, and the runner retires everything on unmount.
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
  /** Explicit application pause, independent from hover/focus interaction. */
  paused: boolean
  /** Pointer is currently over the carousel root. */
  hovered: boolean
  /** DOM focus is currently contained by the carousel root. */
  focusWithin: boolean
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
  /** Whether direction follows the mounted DOM or explicit init/setDir configuration. */
  dirSource: DirectionSource
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
  /** @humanOnly */
  | { type: 'setHovered'; hovered: boolean }
  /** @humanOnly */
  | { type: 'setFocusWithin'; focusWithin: boolean }
  /** @intent("Turn autoplay on or off") */
  | { type: 'setAutoplay'; autoplay: boolean }
  /**
   * The autoplay timer fired. Advances exactly like `next`, but does NOT
   * restart the timer — it IS the timer. Manual navigation restarts it; a tick
   * must not, or the period would be re-armed on every fire.
   *
   * `@humanOnly` because it is the TIMER's message, not a user intent: with no
   * tag it defaulted to dispatchMode `'shared'` and an agent could fire the
   * timer directly, advancing the carousel without re-arming the period
   * (#138 review, item 8). An agent that wants the next slide sends `next`.
   *
   * @humanOnly
   */
  | { type: 'autoplayTick' }
  /** @humanOnly */
  | { type: 'dragStart'; x: number }
  /** @humanOnly */
  | { type: 'dragMove'; x: number }
  /** @humanOnly */
  | { type: 'dragEnd' }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }
  /** @humanOnly — synchronized from the mounted root's live ancestor direction. */
  | { type: 'syncDomDir'; dir: 'ltr' | 'rtl' }

/**
 * Effects emitted by the carousel machine. Running the timer is the consumer's
 * job — the machine only says when it should run (see the module header).
 */
export type CarouselEffect =
  /**
   * Run the autoplay timer: dispatch `autoplayTick` every `interval` ms.
   * Re-emitted to RESTART a timer already running (manual navigation, an
   * `interval` change), so the handler must replace rather than add.
   */
  | { type: 'startAutoplay'; interval: number }
  /** Retire the autoplay timer. */
  | { type: 'stopAutoplay' }

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
  const direction = initDirection(opts.dir)
  return {
    current: finiteOrDefault(opts.current, 0),
    // `count` is the bound every index is clamped into, `interval` and
    // `swipeThreshold` the thresholds autoplay and a swipe are measured
    // against: a non-finite one is unserializable and `clampIndex` would carry
    // it into `current` (#177).
    count: finiteBound(opts.count) ?? 0,
    loop: opts.loop ?? true,
    autoplay: opts.autoplay ?? false,
    interval: finiteBound(opts.interval) ?? 5000,
    paused: false,
    hovered: false,
    focusWithin: false,
    direction: 'forward',
    swipeThreshold: finiteBound(opts.swipeThreshold) ?? 50,
    dragging: null,
    ...direction,
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

function reduce(state: CarouselState, msg: CarouselMsg): CarouselState {
  switch (msg.type) {
    case 'goTo': {
      if (!allFiniteNumbers(msg.index)) return state
      const next = clampIndex(state, msg.index)
      return { ...state, current: next, direction: next >= state.current ? 'forward' : 'backward' }
    }
    case 'next':
    case 'autoplayTick': {
      const next = clampIndex(state, state.current + 1)
      return { ...state, current: next, direction: 'forward' }
    }
    case 'prev': {
      const prev = clampIndex(state, state.current - 1)
      return { ...state, current: prev, direction: 'backward' }
    }
    case 'setCount': {
      // Dropped rather than stored: a slide count has no "absent" spelling and
      // a non-finite one lands in `current` too, via the clamp below (#177).
      const count = finiteBound(msg.count)
      if (count === undefined) return state
      const current = Math.min(state.current, Math.max(0, count - 1))
      return { ...state, count, current }
    }
    case 'pause':
      return { ...state, paused: true }
    case 'resume':
      return { ...state, paused: false }
    case 'setHovered':
      return state.hovered === msg.hovered ? state : { ...state, hovered: msg.hovered }
    case 'setFocusWithin':
      return state.focusWithin === msg.focusWithin
        ? state
        : { ...state, focusWithin: msg.focusWithin }
    case 'setAutoplay':
      return { ...state, autoplay: msg.autoplay }
    case 'dragStart':
      if (!allFiniteNumbers(msg.x)) return state
      return { ...state, dragging: { startX: msg.x, deltaX: 0 } }
    case 'dragMove': {
      if (!state.dragging) return state
      if (!allFiniteNumbers(msg.x)) return state
      const deltaX = msg.x - state.dragging.startX
      if (!Number.isFinite(deltaX)) return state
      if (deltaX === state.dragging.deltaX) return state
      return { ...state, dragging: { ...state.dragging, deltaX } }
    }
    case 'dragEnd': {
      if (!state.dragging) return state
      const decision = swipeDecision(state)
      if (decision === 'next') {
        const next = clampIndex(state, state.current + 1)
        return { ...state, current: next, direction: 'forward', dragging: null }
      }
      if (decision === 'prev') {
        const prev = clampIndex(state, state.current - 1)
        return { ...state, current: prev, direction: 'backward', dragging: null }
      }
      return { ...state, dragging: null }
    }
    case 'setDir':
      return setDirection(state, msg.dir)
    case 'syncDomDir':
      return syncDomDirection(state, msg.dir)
  }
}

/**
 * Whether the autoplay timer should be running. A single slide has nowhere to
 * advance to, and a swipe in flight suspends autoplay so the slide doesn't move
 * out from under the user's finger — the same condition `data-paused` exposes.
 */
export function isAutoplayRunning(state: CarouselState): boolean {
  return (
    state.autoplay &&
    !state.paused &&
    !state.hovered &&
    !state.focusWithin &&
    state.dragging === null &&
    state.count > 1
  )
}

/**
 * The effects that bring the timer in line with `state` from a cold start.
 * `init()` returns state only, so a consumer seeds the timer with this from
 * its own `init()`.
 */
export function autoplayEffects(state: CarouselState): CarouselEffect[] {
  return isAutoplayRunning(state) ? [{ type: 'startAutoplay', interval: state.interval }] : []
}

/**
 * Messages that count as NAVIGATION: they restart a running timer, so the user
 * gets a full period on the slide they just chose instead of the remainder of
 * the previous one. `autoplayTick` is deliberately absent — it IS the timer.
 */
const NAVIGATION: ReadonlySet<CarouselMsg['type']> = new Set(['goTo', 'next', 'prev', 'dragEnd'])

function autoplayTransition(
  prev: CarouselState,
  next: CarouselState,
  msg: CarouselMsg,
): CarouselEffect[] {
  const wasRunning = isAutoplayRunning(prev)
  const isRunning = isAutoplayRunning(next)
  if (!isRunning) return wasRunning ? [{ type: 'stopAutoplay' }] : []
  // `next !== prev` matters: `dragEnd` with no drag in flight returns the state
  // unchanged, and restarting the period off a stray `pointerup` gave the user
  // a fresh interval for free (#138 review, item 7). A navigation that holds
  // the index but moves `direction` IS a change and does restart.
  //
  // No message changes `interval`, so there is nothing to compare there; if one
  // is ever added it must join NAVIGATION, or a live timer will keep the old
  // period.
  const restart = !wasRunning || (next !== prev && NAVIGATION.has(msg.type))
  return restart ? [{ type: 'startAutoplay', interval: next.interval }] : []
}

export function update(state: CarouselState, msg: CarouselMsg): [CarouselState, CarouselEffect[]] {
  const next = reduce(state, msg)
  return [next, autoplayTransition(state, next, msg)]
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
    /** APG roving tab stop: only the selected indicator participates in Tab. */
    tabindex: Signal<0 | -1>
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
    id: string
    role: 'region'
    'aria-roledescription': 'carousel'
    'aria-label': string
    'data-scope': 'carousel'
    'data-part': 'root'
    'data-paused': Signal<'' | undefined>
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocusIn: (e: FocusEvent) => void
    onFocusOut: (e: FocusEvent) => void
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
    /** Physical pointer delta consumed by either skin's track transform. */
    'style.--carousel-drag-offset': Signal<string | undefined>
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
  }
  /** Place all slides directly inside this transform-bearing track. */
  track: {
    'data-scope': 'carousel'
    'data-part': 'track'
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
  /** Place once anywhere in the same build to keep automatic direction live. */
  directionSync: Mountable
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
  const locale = carouselLocale()
  const label = opts.label ?? locale.label
  const indicatorLabel = opts.indicatorLabel ?? locale.indicators
  const nextLabel = opts.nextLabel ?? locale.next
  const prevLabel = opts.prevLabel ?? locale.prev
  const slideLabelFn = opts.slideLabel ?? locale.slide
  const slideId = (i: number): string => `${opts.id}:slide:${i}`
  /**
   * APG's automatic-activation tab model moves both selection and real DOM
   * focus. The reducer owns selection; this connector owns the DOM half and
   * addresses another bare indicator through the semantic part/index attrs it
   * already publishes. No renderer-specific wrapper or child is required.
   */
  const focusIndicator = (origin: Element | null, index: number): void => {
    if (origin === null) return
    const root: ParentNode =
      origin.closest('[data-scope="carousel"][data-part="indicator-group"]') ??
      origin.closest('[data-scope="carousel"][data-part="root"]') ??
      origin.ownerDocument ??
      origin
    const target = root.querySelector(
      `[data-scope="carousel"][data-part="indicator"][data-index="${index}"]`,
    )
    if (target instanceof HTMLElement) target.focus()
  }

  return {
    root: {
      id: opts.id,
      role: 'region',
      'aria-roledescription': 'carousel',
      'aria-label': label,
      'data-scope': 'carousel',
      'data-part': 'root',
      // Autoplay is suppressed both on explicit pause AND while a swipe is in
      // flight, so the slide doesn't advance out from under the user's finger.
      'data-paused': state.map((s) =>
        s.paused || s.hovered || s.focusWithin || s.dragging !== null ? '' : undefined,
      ),
      onPointerEnter: tagSend(send, ['setHovered'], () =>
        send({ type: 'setHovered', hovered: true }),
      ),
      onPointerLeave: tagSend(send, ['setHovered'], () =>
        send({ type: 'setHovered', hovered: false }),
      ),
      onFocusIn: tagSend(send, ['setFocusWithin'], () =>
        send({ type: 'setFocusWithin', focusWithin: true }),
      ),
      onFocusOut: tagSend(send, ['setFocusWithin'], (e) => {
        const root = e.currentTarget
        const next = e.relatedTarget
        if (root instanceof Node && next instanceof Node && root.contains(next)) return
        send({ type: 'setFocusWithin', focusWithin: false })
      }),
    },
    viewport: {
      'data-scope': 'carousel',
      'data-part': 'viewport',
      'data-dragging': state.map((s) => (s.dragging !== null ? '' : undefined)),
      'data-drag-offset': state.map((s) =>
        s.dragging !== null ? `${s.dragging.deltaX}px` : undefined,
      ),
      // `deltaX` is deliberately physical in both directions: the content
      // follows the pointer itself. RTL flips horizontal keyboard arrows; a
      // pointer delta and the swipe threshold remain physical screen motion.
      'style.--carousel-drag-offset': state.map((s) =>
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
    track: {
      'data-scope': 'carousel',
      'data-part': 'track',
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
        tabindex: state.map((s): 0 | -1 => (s.current === index ? 0 : -1)),
        'aria-label': locale.goToSlide(index),
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
          const key = flipArrow(e.key, eventDirection(s, e.currentTarget as Element | null))
          const move = (targetIndex: number): void => {
            e.preventDefault()
            send({ type: 'goTo', index: targetIndex })
            focusIndicator(e.currentTarget as Element | null, targetIndex)
          }
          switch (key) {
            case 'ArrowRight': {
              move(clampIndex(s, index + 1))
              return
            }
            case 'ArrowLeft': {
              move(clampIndex(s, index - 1))
              return
            }
            case 'Home': {
              move(0)
              return
            }
            case 'End': {
              move(s.count - 1)
              return
            }
          }
        }),
      },
    }),
    directionSync: directionSyncMount(opts.id, (dir) => send({ type: 'syncDomDir', dir })),
  }
}

export const carousel = {
  init,
  update,
  connect,
  canGoNext,
  canGoPrev,
  swipeDecision,
  isAutoplayRunning,
  autoplayEffects,
}
