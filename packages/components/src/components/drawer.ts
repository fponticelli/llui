import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay } from '../utils/overlay-engine.js'
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
  /**
   * Optional enter/leave transition for the drawer content (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, so the close plays an exit animation.
   * Keep `skipAnimations` at its default (true) when driving exits this way.
   *
   * @example drawer.overlay({ state, send, parts, content, transition: slide({ duration: 200 }) })
   */
  transition?: TransitionOptions
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
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus !== false
  // Two-phase like dialog: mounted through the exit animation (isMounted),
  // interaction wiring (scroll lock / aria-hidden / focus trap / dismissable)
  // unwinds at the close REQUEST (isVisible). Ids resolve against `document`.
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: opts.parts.positioner,
    content: opts.content,
    contentId: opts.parts.content.id,
    anchorId: opts.parts.trigger.id,
    idScope: 'document',
    mountWhen: isMounted,
    visibleWhen: isVisible,
    onDismiss: () => opts.send({ type: 'close' }),
    lockScroll: opts.lockScroll !== false,
    hideSiblings: opts.hideSiblings !== false,
    focusTrap: trapFocus
      ? { initialFocus: opts.initialFocus, restoreFocus: opts.restoreFocus !== false }
      : undefined,
    dismiss:
      closeOnEscape || closeOnOutsideClick
        ? { disableEscape: !closeOnEscape, disableOutside: !closeOnOutsideClick }
        : undefined,
  })
}

export const drawer = { init, update, connect, overlay, isMounted, isPresent }
