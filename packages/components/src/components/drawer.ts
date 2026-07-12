import type { Send, Signal, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { pushDismissable } from '../utils/dismissable.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { pushFocusTrap } from '../utils/focus-trap.js'
import { setAriaHiddenOutside } from '../utils/aria-hidden.js'
import { lockBodyScroll } from '../utils/remove-scroll.js'
import type { PresenceStatus } from './presence.js'

/**
 * Drawer — a panel that slides in from a screen edge. Structurally
 * identical to dialog (portal + focus trap + dismissable + aria-hidden +
 * scroll lock), but adds a `side` so styling can animate from that edge.
 */

export type DrawerSide = 'left' | 'right' | 'top' | 'bottom'

export interface DrawerState {
  open: boolean
  /** Presence lifecycle — drives data-state and keeps the node mounted through exit animations. */
  status: PresenceStatus
  /** When true, close transitions go straight to 'closed' (no exit-animation wait). */
  skipAnimations: boolean
}

export type DrawerMsg =
  /** @intent("Open the drawer") */
  | { type: 'open' }
  /** @intent("Close the drawer") */
  | { type: 'close' }
  /** @intent("Toggle the drawer open/closed") */
  | { type: 'toggle' }
  /** @intent("Set the drawer's open state to a specific value") */
  | { type: 'setOpen'; open: boolean }
  /** @humanOnly */
  | { type: 'animationEnd' }
  /** @humanOnly */
  | { type: 'transitionEnd' }

export interface DrawerInit {
  open?: boolean
  /** Skip enter/exit animations — close unmounts synchronously (default: true). */
  skipAnimations?: boolean
}

export function init(opts: DrawerInit = {}): DrawerState {
  const open = opts.open ?? false
  return {
    open,
    status: open ? 'open' : 'closed',
    skipAnimations: opts.skipAnimations ?? true,
  }
}

function openTo(state: DrawerState): DrawerState {
  if (state.open && (state.status === 'open' || state.status === 'opening')) return state
  return { ...state, open: true, status: state.skipAnimations ? 'open' : 'opening' }
}

function closeTo(state: DrawerState): DrawerState {
  if (!state.open && (state.status === 'closed' || state.status === 'closing')) return state
  return { ...state, open: false, status: state.skipAnimations ? 'closed' : 'closing' }
}

export function update(state: DrawerState, msg: DrawerMsg): [DrawerState, never[]] {
  switch (msg.type) {
    case 'open':
      return [openTo(state), []]
    case 'close':
      return [closeTo(state), []]
    case 'toggle':
      return [state.open ? closeTo(state) : openTo(state), []]
    case 'setOpen':
      return [msg.open ? openTo(state) : closeTo(state), []]
    case 'animationEnd':
    case 'transitionEnd':
      if (state.status === 'opening') return [{ ...state, status: 'open' }, []]
      if (state.status === 'closing') return [{ ...state, status: 'closed' }, []]
      return [state, []]
  }
}

/** Whether the drawer node should be in the DOM — true through the exit animation.
 * Tolerates a partial slice without `status` by falling back to `open` (instant unmount). */
export function isMounted(state: DrawerState): boolean {
  return state.status === undefined ? state.open : state.status !== 'closed'
}

/** Alias of {@link isMounted} — whether the drawer is currently present in the DOM. */
export function isPresent(state: DrawerState): boolean {
  return isMounted(state)
}

/** Whether the drawer is in its visible phase (open/opening) vs leaving (closing/closed).
 * Falls back to `open` when a partial slice has no `status`. */
function isVisible(state: DrawerState): boolean {
  return state.status === undefined
    ? state.open
    : state.status === 'open' || state.status === 'opening'
}

/** Resolve the presence status for `data-state`, falling back to open/closed when a
 * partial state (no `status`) is supplied (e.g. in unit tests). */
function statusOf(state: DrawerState): PresenceStatus {
  return state.status ?? (state.open ? 'open' : 'closed')
}

export interface DrawerParts {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'drawer'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  backdrop: {
    'data-state': Signal<PresenceStatus>
    'data-scope': 'drawer'
    'data-part': 'backdrop'
    'aria-hidden': 'true'
  }
  positioner: {
    'data-scope': 'drawer'
    'data-part': 'positioner'
    'data-side': DrawerSide
  }
  content: {
    role: 'dialog'
    id: string
    'aria-modal': 'true'
    'aria-labelledby': string
    tabindex: -1
    'data-state': Signal<PresenceStatus>
    'data-scope': 'drawer'
    'data-part': 'content'
    'data-side': DrawerSide
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  title: {
    id: string
    'data-scope': 'drawer'
    'data-part': 'title'
  }
  description: {
    id: string
    'data-scope': 'drawer'
    'data-part': 'description'
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'drawer'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  side?: DrawerSide
  closeLabel?: string
}

export function connect(
  state: Signal<DrawerState>,
  send: Send<DrawerMsg>,
  opts: ConnectOptions,
): DrawerParts {
  const locale = useContext(LocaleContext)
  const side = opts.side ?? 'right'
  const base = opts.id
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const triggerId = `${base}:trigger`
  const closeLabel = opts.closeLabel ?? locale.drawer.close

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      id: triggerId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'drawer',
      'data-part': 'trigger',
      onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
    },
    backdrop: {
      'data-state': state.map(statusOf),
      'data-scope': 'drawer',
      'data-part': 'backdrop',
      'aria-hidden': 'true',
    },
    positioner: {
      'data-scope': 'drawer',
      'data-part': 'positioner',
      'data-side': side,
    },
    content: {
      role: 'dialog',
      id: contentId,
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: -1,
      'data-state': state.map(statusOf),
      'data-scope': 'drawer',
      'data-part': 'content',
      'data-side': side,
      onAnimationEnd: () => send({ type: 'animationEnd' }),
      onTransitionEnd: () => send({ type: 'transitionEnd' }),
    },
    title: {
      id: titleId,
      'data-scope': 'drawer',
      'data-part': 'title',
    },
    description: {
      id: descId,
      'data-scope': 'drawer',
      'data-part': 'description',
    },
    closeTrigger: {
      type: 'button',
      'aria-label': closeLabel,
      'data-scope': 'drawer',
      'data-part': 'close-trigger',
      onClick: tagSend(send, ['close'], () => send({ type: 'close' })),
    },
  }
}

export interface OverlayOptions {
  state: Signal<DrawerState>
  send: Send<DrawerMsg>
  parts: DrawerParts
  content: () => Renderable
  closeOnEscape?: boolean
  closeOnOutsideClick?: boolean
  trapFocus?: boolean
  lockScroll?: boolean
  hideSiblings?: boolean
  target?: string | HTMLElement
  initialFocus?: Element | (() => Element | null)
  restoreFocus?: boolean
}

export function overlay(opts: OverlayOptions): Mountable {
  const targetOpt = opts.target ?? 'body'
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus !== false
  const lockScroll = opts.lockScroll !== false
  const hideSiblings = opts.hideSiblings !== false
  const restoreFocus = opts.restoreFocus !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id
  const host = resolvePortalTarget(targetOpt)

  // Outer block stays mounted through the exit animation (isMounted, status !==
  // 'closed'); the inner block tracks the VISIBLE phase (isVisible, open/opening)
  // so interaction wiring — focus trap, scroll lock, aria-hidden, dismissable —
  // tears down at the close REQUEST while the node lingers for the exit
  // animation. With `skipAnimations` (the default) both flip together, so close
  // unmounts and tears down synchronously (no hang waiting on animationEnd).
  return show(opts.state.map(isMounted), () => [
    portal(() => {
      const interaction = show(opts.state.map(isVisible), () => [
        onMount(() => {
          const contentEl = document.getElementById(contentId)
          if (!contentEl) return
          const triggerEl = document.getElementById(triggerId)

          const cleanups: Array<() => void> = []

          if (lockScroll) cleanups.push(lockBodyScroll())
          if (hideSiblings) cleanups.push(setAriaHiddenOutside(contentEl))
          if (trapFocus) {
            cleanups.push(
              pushFocusTrap({
                container: contentEl,
                initialFocus: opts.initialFocus,
                restoreFocus,
              }),
            )
          }
          if (closeOnEscape || closeOnOutsideClick) {
            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => (triggerEl ? [triggerEl] : []),
                disableEscape: !closeOnEscape,
                disableOutside: !closeOnOutsideClick,
                onDismiss: () => opts.send({ type: 'close' }),
              }),
            )
          }

          return () => {
            for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
          }
        }),
      ])

      return [interaction, div(parts.positioner, opts.content())]
    }, host),
  ])
}

export const drawer = { init, update, connect, overlay, isMounted, isPresent }
