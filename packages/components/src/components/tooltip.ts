import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { attachFloating, type Placement } from '../utils/floating.js'
import { pushDismissable } from '../utils/dismissable.js'
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

  const scheduleShow = (delay: number): void => {
    clearTimers()
    if (delay <= 0) {
      send({ type: 'show' })
      return
    }
    openTimer = setTimeout(() => {
      openTimer = null
      send({ type: 'show' })
    }, delay)
  }

  const scheduleHide = (delay: number): void => {
    clearTimers()
    if (delay <= 0) {
      send({ type: 'hide' })
      return
    }
    closeTimer = setTimeout(() => {
      closeTimer = null
      send({ type: 'hide' })
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
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
  arrowSelector?: string
  /** Dismiss on Escape regardless of where focus is (default: true). */
  closeOnEscape?: boolean
}

export function overlay(opts: OverlayOptions): Mountable {
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'top'
  const offset = opts.offset ?? 6
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id
  const closeOnEscape = opts.closeOnEscape !== false

  // Mount through the exit animation: when `animated`, the node stays mounted
  // while `status === 'closing'` and is removed only once `animationEnd` lands
  // it on `closed`. When not animated, `closing` is skipped so this collapses
  // to today's instant unmount (no hang waiting for an animation that never fires).
  return show(opts.state.map(isMounted), () => {
    const targetEl =
      typeof rawTarget === 'string'
        ? (document.querySelector(rawTarget) ?? document.body)
        : rawTarget
    return [
      portal(() => {
        const dismissable = onMount(() => {
          const contentEl = document.getElementById(contentId)
          const triggerEl = document.getElementById(triggerId)
          if (!contentEl || !triggerEl) return

          const cleanups: Array<() => void> = []

          const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
          const floatingEl = positioner ?? contentEl
          const arrow = opts.arrowSelector
            ? (contentEl.querySelector(opts.arrowSelector) as HTMLElement | null)
            : null
          cleanups.push(
            attachFloating({
              anchor: triggerEl,
              floating: floatingEl,
              placement,
              offset,
              flip,
              shift,
              arrow: arrow ?? undefined,
            }),
          )

          // Escape dismisses regardless of where focus sits (trigger, content,
          // or elsewhere). Outside-click is intentionally disabled — tooltips
          // dismiss on blur / pointer-leave, not on clicks elsewhere.
          if (closeOnEscape) {
            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => [triggerEl],
                disableOutside: true,
                onDismiss: () => opts.send({ type: 'hide' }),
              }),
            )
          }

          return () => {
            for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
          }
        })
        return [dismissable, div(parts.positioner, opts.content())]
      }, targetEl),
    ]
  })
}

export const tooltip = { init, update, connect, overlay, isMounted }
