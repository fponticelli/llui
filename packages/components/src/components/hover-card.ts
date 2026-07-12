import type { Send, Signal, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { attachFloating, type Placement } from '../utils/floating.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { getElementByIdInScope } from '../utils/root-scope.js'
import { pushDismissable } from '../utils/dismissable.js'
import type { PresenceStatus } from './presence.js'

/**
 * Hover card — richer tooltip-like popup triggered by hover or focus.
 * Unlike tooltip, it uses `role="dialog"` (not `role="tooltip"`) and
 * allows interactive content. Content can be hovered without closing.
 */

export interface HoverCardState {
  open: boolean
  /** Presence lifecycle — drives data-state and keeps the node mounted through exit animations. */
  status: PresenceStatus
  /** When true, hide transitions go straight to 'closed' (no exit-animation wait). */
  skipAnimations: boolean
}

export type HoverCardMsg =
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'setOpen'; open: boolean }
  /** @humanOnly */
  | { type: 'animationEnd' }
  /** @humanOnly */
  | { type: 'transitionEnd' }

export interface HoverCardInit {
  open?: boolean
  /** Skip enter/exit animations — hide unmounts synchronously (default: true). */
  skipAnimations?: boolean
}

export function init(opts: HoverCardInit = {}): HoverCardState {
  const open = opts.open ?? false
  return {
    open,
    status: open ? 'open' : 'closed',
    skipAnimations: opts.skipAnimations ?? true,
  }
}

function showTo(state: HoverCardState): HoverCardState {
  if (state.open && (state.status === 'open' || state.status === 'opening')) return state
  return { ...state, open: true, status: state.skipAnimations ? 'open' : 'opening' }
}

function hideTo(state: HoverCardState): HoverCardState {
  if (!state.open && (state.status === 'closed' || state.status === 'closing')) return state
  return { ...state, open: false, status: state.skipAnimations ? 'closed' : 'closing' }
}

export function update(state: HoverCardState, msg: HoverCardMsg): [HoverCardState, never[]] {
  switch (msg.type) {
    case 'show':
      return [showTo(state), []]
    case 'hide':
      return [hideTo(state), []]
    case 'setOpen':
      return [msg.open ? showTo(state) : hideTo(state), []]
    case 'animationEnd':
    case 'transitionEnd':
      if (state.status === 'opening') return [{ ...state, status: 'open' }, []]
      if (state.status === 'closing') return [{ ...state, status: 'closed' }, []]
      return [state, []]
  }
}

/** Whether the hover-card node should be in the DOM — true through the exit animation. */
export function isMounted(state: HoverCardState): boolean {
  return state.status !== 'closed'
}

/** Alias of {@link isMounted} — whether the hover-card is currently present in the DOM. */
export function isPresent(state: HoverCardState): boolean {
  return isMounted(state)
}

export interface HoverCardParts {
  trigger: {
    id: string
    'aria-controls': string
    'aria-expanded': Signal<boolean>
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'hover-card'
    'data-part': 'trigger'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onBlur: (e: FocusEvent) => void
  }
  positioner: {
    'data-scope': 'hover-card'
    'data-part': 'positioner'
    style: string
  }
  content: {
    id: string
    'data-state': Signal<PresenceStatus>
    'data-scope': 'hover-card'
    'data-part': 'content'
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  arrow: {
    'data-scope': 'hover-card'
    'data-part': 'arrow'
  }
}

export interface ConnectOptions {
  id: string
  /** ms before showing on hover (default: 700). */
  openDelay?: number
  /** ms before hiding after pointer leaves (default: 300). */
  closeDelay?: number
}

export function connect(
  state: Signal<HoverCardState>,
  send: Send<HoverCardMsg>,
  opts: ConnectOptions,
): HoverCardParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const openDelay = opts.openDelay ?? 700
  const closeDelay = opts.closeDelay ?? 300

  let openTimer: ReturnType<typeof setTimeout> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = (): void => {
    if (openTimer) {
      clearTimeout(openTimer)
      openTimer = null
    }
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  // A hover-intent timer must not act after the component unmounts (its trigger
  // leaves the DOM), or it dispatches to a disposed handle. Capture the trigger
  // when the timer is scheduled; if it was live then but is detached when the
  // timer fires, the component unmounted — drop the message. (When there is no
  // trigger element at all, e.g. a unit test, no guard is applied.)
  const detached = (el: Element | null): boolean => el !== null && !el.isConnected

  const scheduleOpen = (): void => {
    clearTimers()
    const trigger = getTrigger()
    openTimer = setTimeout(() => {
      openTimer = null
      if (!detached(trigger)) send({ type: 'show' })
    }, openDelay)
  }

  const scheduleClose = (): void => {
    clearTimers()
    const trigger = getTrigger()
    closeTimer = setTimeout(() => {
      closeTimer = null
      if (!detached(trigger)) send({ type: 'hide' })
    }, closeDelay)
  }

  const getTrigger = (): Element | null =>
    typeof document === 'undefined' ? null : document.getElementById(triggerId)

  return {
    trigger: {
      id: triggerId,
      'aria-controls': contentId,
      'aria-expanded': state.map((s) => s.open),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'hover-card',
      'data-part': 'trigger',
      onPointerEnter: scheduleOpen,
      onPointerLeave: scheduleClose,
      onFocus: scheduleOpen,
      onBlur: scheduleClose,
    },
    positioner: {
      'data-scope': 'hover-card',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      // No role: a hover-card is supplementary, non-modal, non-focusable
      // content surfaced on hover/focus. `role="dialog"` wrongly implied a modal
      // dialog (with the focus-management contract AT expects of one).
      id: contentId,
      'data-state': state.map((s) => s.status),
      'data-scope': 'hover-card',
      'data-part': 'content',
      onPointerEnter: () => {
        if (closeTimer) {
          clearTimeout(closeTimer)
          closeTimer = null
        }
      },
      onPointerLeave: scheduleClose,
      onAnimationEnd: () => send({ type: 'animationEnd' }),
      onTransitionEnd: () => send({ type: 'transitionEnd' }),
    },
    arrow: {
      'data-scope': 'hover-card',
      'data-part': 'arrow',
    },
  }
}

export interface OverlayOptions {
  state: Signal<HoverCardState>
  send: Send<HoverCardMsg>
  parts: HoverCardParts
  content: () => Renderable
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  target?: string | HTMLElement
  arrowSelector?: string
}

export function overlay(opts: OverlayOptions): Mountable {
  const host = resolvePortalTarget(opts.target ?? 'body')
  const placement = opts.placement ?? 'bottom'
  const offset = opts.offset ?? 8
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  // Stay mounted through the exit animation (status !== 'closed'); the content
  // keeps its floating position while the close transition plays.
  return show(
    opts.state.map((s) => isMounted(s)),
    () => {
      return [
        portal(() => {
          const dismissable = onMount((root) => {
            const contentEl = getElementByIdInScope(root, contentId)
            const triggerEl = getElementByIdInScope(root, triggerId)
            if (!contentEl || !triggerEl) return
            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            const arrow = opts.arrowSelector
              ? (contentEl.querySelector(opts.arrowSelector) as HTMLElement | null)
              : null
            const cleanups: Array<() => void> = []
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
            // Escape dismisses the card (WAI-ARIA). Outside-click dismissal is
            // disabled — a hover-card closes on pointer-leave, not on click.
            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => [triggerEl],
                disableOutside: true,
                onDismiss: () => opts.send({ type: 'hide' }),
              }),
            )
            return () => {
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
            }
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, host),
      ]
    },
  )
}

export const hoverCard = { init, update, connect, overlay, isMounted, isPresent }
