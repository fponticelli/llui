import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { type Placement } from '../utils/floating.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay } from '../utils/overlay-engine.js'
import type { PresenceStatus } from './presence.js'
import { isMounted as presenceIsMounted } from './presence.js'

/**
 * Tooltip — hover / focus-triggered, positioned. Opens after a short delay
 * to avoid flicker from passing pointers, closes immediately on blur or
 * after a grace period on pointer leave.
 *
 * Pure reducer handles only the boolean `open` state; timing (delays,
 * debouncing) lives in the event handlers returned from `connect()`, which
 * close over per-instance timers.
 */

export interface TooltipState {
  /**
   * Whether the tooltip is intended to be visible (true while `opening`/`open`,
   * false once a close is requested). Flips to false at close-request time —
   * exactly as today — so existing consumers reading `open` are unaffected.
   * The DOM node is kept mounted through an exit animation via `status`, not
   * `open`. Backed by the presence lifecycle in `status`.
   */
  open: boolean
  /**
   * Full presence lifecycle. `closed → opening → open → closing → closed`.
   * When `animated` is false (the default) a close skips `closing` and lands
   * on `closed` synchronously, matching today's instant unmount.
   */
  status: PresenceStatus
  /**
   * Whether an exit animation is configured. When false, closing is
   * synchronous (no `closing` state, no waiting for `animationEnd`).
   */
  animated: boolean
}

export type TooltipMsg =
  /** @intent("Show the tooltip") */
  | { type: 'show' }
  /** @intent("Hide the tooltip") */
  | { type: 'hide' }
  /** @intent("Toggle the tooltip's visibility") */
  | { type: 'toggle' }
  /** @intent("Set the tooltip's open state to a specific value") */
  | { type: 'setOpen'; open: boolean }
  /** @humanOnly */
  | { type: 'animationEnd' }

export interface TooltipInit {
  open?: boolean
  /**
   * Enable the exit-animation lifecycle: a close enters `closing` and stays
   * mounted until `animationEnd`. Default false (instant unmount). The
   * `overlay()` helper turns this on automatically when given a `transition`.
   */
  animated?: boolean
}

export function init(opts: TooltipInit = {}): TooltipState {
  const open = opts.open ?? false
  return { open, status: open ? 'open' : 'closed', animated: opts.animated ?? false }
}

/** Move `status` toward visible, mirroring presence's open transition. */
function toOpen(state: TooltipState): TooltipState {
  if (state.status === 'open' || state.status === 'opening') {
    return { ...state, open: true }
  }
  return { ...state, open: true, status: state.animated ? 'opening' : 'open' }
}

/**
 * Move `status` toward hidden. When animated, enter `closing` and wait for
 * `animationEnd`; otherwise land on `closed` synchronously (no-hang rule).
 */
function toClose(state: TooltipState): TooltipState {
  if (state.status === 'closed' || state.status === 'closing') {
    return { ...state, open: false }
  }
  return { ...state, open: false, status: state.animated ? 'closing' : 'closed' }
}

export function update(state: TooltipState, msg: TooltipMsg): [TooltipState, never[]] {
  switch (msg.type) {
    case 'show':
      return [toOpen(state), []]
    case 'hide':
      return [toClose(state), []]
    case 'toggle':
      return [state.open ? toClose(state) : toOpen(state), []]
    case 'setOpen':
      return [msg.open ? toOpen(state) : toClose(state), []]
    case 'animationEnd':
      if (state.status === 'opening') return [{ ...state, status: 'open' }, []]
      if (state.status === 'closing') return [{ ...state, status: 'closed', open: false }, []]
      return [state, []]
  }
}

/** Whether the tooltip should be in the DOM (mounted through the exit animation). */
export function isMounted(state: TooltipState): boolean {
  return presenceIsMounted({ status: state.status, unmountOnExit: true })
}

export interface TooltipParts {
  trigger: {
    id: string
    'aria-describedby': Signal<string | undefined>
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'tooltip'
    'data-part': 'trigger'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  positioner: {
    'data-scope': 'tooltip'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'tooltip'
    id: string
    style: string
    'data-state': Signal<PresenceStatus>
    'data-scope': 'tooltip'
    'data-part': 'content'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  arrow: {
    'data-scope': 'tooltip'
    'data-part': 'arrow'
  }
}

export interface ConnectOptions {
  id: string
  /** ms to wait before opening (default: 300). */
  delayOpen?: number
  /** ms to wait before closing after pointer leaves (default: 100). */
  delayClose?: number
  /** Open immediately on focus without delay (default: true). */
  openOnFocus?: boolean
}

export function connect(
  state: Signal<TooltipState>,
  send: Send<TooltipMsg>,
  opts: ConnectOptions,
): TooltipParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const delayOpen = opts.delayOpen ?? 300
  const delayClose = opts.delayClose ?? 100
  const openOnFocus = opts.openOnFocus !== false

  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const cancelClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  const clearTimers = (): void => {
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
    cancelClose()
  }

  const dismissOnEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      clearTimers()
      send({ type: 'hide' })
    }
  }

  const onEnd = (): void => send({ type: 'animationEnd' })

  // A pending hover timer must not act once the component unmounts (its trigger
  // leaves the DOM), or it dispatches to a disposed handle. Capture the trigger
  // at schedule time; drop the message if it was live then but is detached when
  // the timer fires. (No trigger element at all, e.g. a unit test → no guard.)
  const detached = (el: Element | null): boolean => el !== null && !el.isConnected
  const getTrigger = (): Element | null =>
    typeof document === 'undefined' ? null : document.getElementById(triggerId)

  const scheduleShow = (delay: number): void => {
    clearTimers()
    if (delay <= 0) {
      send({ type: 'show' })
      return
    }
    const trigger = getTrigger()
    openTimer = setTimeout(() => {
      openTimer = null
      if (!detached(trigger)) send({ type: 'show' })
    }, delay)
  }

  const scheduleHide = (delay: number): void => {
    clearTimers()
    if (delay <= 0) {
      send({ type: 'hide' })
      return
    }
    const trigger = getTrigger()
    closeTimer = setTimeout(() => {
      closeTimer = null
      if (!detached(trigger)) send({ type: 'hide' })
    }, delay)
  }

  return {
    trigger: {
      id: triggerId,
      'aria-describedby': state.map((s) => (s.open ? contentId : undefined)),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'tooltip',
      'data-part': 'trigger',
      onPointerEnter: () => scheduleShow(delayOpen),
      onPointerLeave: () => scheduleHide(delayClose),
      onFocus: () => {
        if (openOnFocus) scheduleShow(0)
      },
      onBlur: () => scheduleHide(0),
      onKeyDown: tagSend(send, ['hide'], dismissOnEscape),
    },
    positioner: {
      'data-scope': 'tooltip',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;pointer-events:none;',
    },
    content: {
      role: 'tooltip',
      id: contentId,
      // The positioner sets `pointer-events:none` (so the invisible box never
      // blocks the page); the content must re-enable pointer events, or the
      // pointer can never land on it and `onPointerEnter` (which cancels the
      // close) never fires — breaking trigger→content travel (WCAG 1.4.13).
      style: 'pointer-events:auto;',
      'data-state': state.map((s) => s.status),
      'data-scope': 'tooltip',
      'data-part': 'content',
      // Allow pointer to enter content without closing (for interactive tooltips):
      // entering the content cancels the close scheduled when the pointer left
      // the trigger, so trigger→content travel keeps the tooltip open (WCAG 1.4.13).
      onPointerEnter: () => cancelClose(),
      // Leaving the content schedules a close after the grace period, symmetric
      // with the trigger handlers.
      onPointerLeave: () => scheduleHide(delayClose),
      // Escape dismisses even when focus is inside the content.
      onKeyDown: tagSend(send, ['hide'], dismissOnEscape),
      // Drive the presence lifecycle past `closing`/`opening` once the exit /
      // enter animation finishes, so an animated tooltip stays mounted until done.
      onAnimationEnd: onEnd,
      onTransitionEnd: onEnd,
    },
    arrow: {
      'data-scope': 'tooltip',
      'data-part': 'arrow',
    },
  }
}

export interface OverlayOptions {
  state: Signal<TooltipState>
  send: Send<TooltipMsg>
  parts: TooltipParts
  content: () => Renderable
  /**
   * Optional enter/leave transition for the tooltip content (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, so the close plays an exit animation.
   * Opt-in only — supplying this does not turn animation on automatically.
   *
   * @example tooltip.overlay({ state, send, parts, content, transition: fade({ duration: 100 }) })
   */
  transition?: TransitionOptions
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  target?: string | HTMLElement
  arrowSelector?: string
  /** Dismiss on Escape regardless of where focus is (default: true). */
  closeOnEscape?: boolean
}

export function overlay(opts: OverlayOptions): Mountable {
  const closeOnEscape = opts.closeOnEscape !== false
  // Mount through the exit animation (isMounted): when `animated`, the node stays
  // mounted while `status === 'closing'` and is removed only once `animationEnd`
  // lands it on `closed`. Escape dismisses regardless of where focus sits;
  // outside-click is disabled (tooltips dismiss on blur / pointer-leave).
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: opts.parts.positioner,
    content: opts.content,
    contentId: opts.parts.content.id,
    anchorId: opts.parts.trigger.id,
    requireAnchor: true,
    mountWhen: isMounted,
    onDismiss: () => opts.send({ type: 'hide' }),
    floating: {
      placement: opts.placement ?? 'top',
      offset: opts.offset ?? 6,
      flip: opts.flip !== false,
      shift: opts.shift !== false,
      arrowSelector: opts.arrowSelector,
    },
    dismiss: closeOnEscape ? { disableOutside: true } : undefined,
  })
}

export const tooltip = { init, update, connect, overlay, isMounted }
