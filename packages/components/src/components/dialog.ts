import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay } from '../utils/overlay-engine.js'
import type { PresenceStatus } from './presence.js'

/**
 * Dialog — modal / non-modal overlay. Ties together focus-trap, dismissable,
 * body scroll lock, sibling aria-hidden, and portal-to-body rendering into
 * a single view helper.
 *
 * Two layers:
 *   - **state machine** (`init`, `update`, `connect`) — pure, minimal.
 *   - **`overlay()` view helper** — opens the dialog's DOM tree inside a
 *     body portal, wires up all accessibility utilities on mount, tears
 *     them down on close, restores focus to the trigger.
 *
 * ```ts
 * view: ({ state, send }) => {
 *   const parts = dialog.connect(state.at('confirm'), send, { id: 'confirm' })
 *   return [
 *     button({ ...parts.trigger, class: 'btn' }, [text('Delete')]),
 *     dialog.overlay({
 *       state: state.at('confirm'),
 *       send,
 *       parts,
 *       content: () => [
 *         div({ ...parts.content, class: 'dialog' }, [
 *           h2({ ...parts.title }, [text('Are you sure?')]),
 *           button({ ...parts.closeTrigger, class: 'btn' }, [text('Cancel')]),
 *         ]),
 *       ],
 *     }),
 *   ]
 * }
 * ```
 */

export interface DialogState {
  open: boolean
  /** Presence lifecycle — drives data-state and keeps the node mounted through exit
   * animations. Optional: a partial `{ open }` bridge (e.g. a pattern passing a
   * slice to `overlay`) omits it, and the runtime falls back to `open` for instant,
   * backward-compatible mount/visibility. `init` always sets it. */
  status?: PresenceStatus
  /** When true, close transitions go straight to 'closed' (no exit-animation wait).
   * Optional for the same partial-slice reason as `status`; `init` always sets it. */
  skipAnimations?: boolean
}

export type DialogMsg =
  /** @intent("Open the dialog") */
  | { type: 'open' }
  /** @intent("Close the dialog") */
  | { type: 'close' }
  /** @intent("Toggle the dialog open/closed") */
  | { type: 'toggle' }
  /** @intent("Set the dialog's open state to a specific value") */
  | { type: 'setOpen'; open: boolean }
  /** @humanOnly */
  | { type: 'animationEnd' }
  /** @humanOnly */
  | { type: 'transitionEnd' }

export interface DialogInit {
  open?: boolean
  /** Skip enter/exit animations — close unmounts synchronously (default: true). */
  skipAnimations?: boolean
}

export function init(opts: DialogInit = {}): DialogState {
  const open = opts.open ?? false
  return {
    open,
    status: open ? 'open' : 'closed',
    skipAnimations: opts.skipAnimations ?? true,
  }
}

function openTo(state: DialogState): DialogState {
  if (state.open && (state.status === 'open' || state.status === 'opening')) return state
  return { ...state, open: true, status: state.skipAnimations ? 'open' : 'opening' }
}

function closeTo(state: DialogState): DialogState {
  if (!state.open && (state.status === 'closed' || state.status === 'closing')) return state
  return { ...state, open: false, status: state.skipAnimations ? 'closed' : 'closing' }
}

export function update(state: DialogState, msg: DialogMsg): [DialogState, never[]] {
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

/** Whether the dialog node should be in the DOM — true through the exit animation.
 * Tolerates a partial slice without `status` (e.g. the `{ open }` bridge a pattern
 * passes to `overlay`): it falls back to `open` for instant, backward-compatible unmount. */
export function isMounted(state: DialogState): boolean {
  return state.status === undefined ? state.open : state.status !== 'closed'
}

/** Alias of {@link isMounted} — whether the dialog is currently present in the DOM. */
export function isPresent(state: DialogState): boolean {
  return isMounted(state)
}

/** Whether the dialog is in its visible phase (open/opening) vs leaving (closing/closed).
 * Falls back to `open` when a partial slice has no `status`. */
function isVisible(state: DialogState): boolean {
  return state.status === undefined
    ? state.open
    : state.status === 'open' || state.status === 'opening'
}

/** Resolve the presence status for `data-state`, falling back to open/closed when a
 * partial state (no `status`) is supplied (e.g. a pattern bridge or a unit test). */
function statusOf(state: DialogState): PresenceStatus {
  return state.status ?? (state.open ? 'open' : 'closed')
}

export interface DialogParts {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'dialog'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  backdrop: {
    'data-state': Signal<PresenceStatus>
    'data-scope': 'dialog'
    'data-part': 'backdrop'
    'aria-hidden': 'true'
  }
  positioner: {
    'data-scope': 'dialog'
    'data-part': 'positioner'
  }
  content: {
    role: 'dialog' | 'alertdialog'
    id: string
    'aria-modal': 'true' | undefined
    'aria-labelledby': string
    'aria-describedby': string
    tabindex: -1
    'data-state': Signal<PresenceStatus>
    'data-scope': 'dialog'
    'data-part': 'content'
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  title: {
    id: string
    'data-scope': 'dialog'
    'data-part': 'title'
  }
  description: {
    id: string
    'data-scope': 'dialog'
    'data-part': 'description'
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'dialog'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  /** Unique id per dialog instance (used for ARIA wiring). */
  id: string
  /** ARIA role (default: 'dialog'). Use 'alertdialog' for destructive confirmations. */
  role?: 'dialog' | 'alertdialog'
  /** Modal dialogs trap focus and lock scroll (default: true). */
  modal?: boolean
  /** Accessible label for the close button (default: 'Close'). */
  closeLabel?: string
}

export function connect(
  state: Signal<DialogState>,
  send: Send<DialogMsg>,
  opts: ConnectOptions,
): DialogParts {
  const base = opts.id
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const triggerId = `${base}:trigger`
  const role = opts.role ?? 'dialog'
  const modal = opts.modal !== false
  const locale = useContext(LocaleContext)
  const closeLabel = opts.closeLabel ?? locale.dialog.close

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      id: triggerId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'dialog',
      'data-part': 'trigger',
      onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
    },
    backdrop: {
      'data-state': state.map(statusOf),
      'data-scope': 'dialog',
      'data-part': 'backdrop',
      'aria-hidden': 'true',
    },
    positioner: {
      'data-scope': 'dialog',
      'data-part': 'positioner',
    },
    content: {
      role,
      id: contentId,
      'aria-modal': modal ? 'true' : undefined,
      'aria-labelledby': titleId,
      'aria-describedby': descId,
      tabindex: -1,
      'data-state': state.map(statusOf),
      'data-scope': 'dialog',
      'data-part': 'content',
      onAnimationEnd: () => send({ type: 'animationEnd' }),
      onTransitionEnd: () => send({ type: 'transitionEnd' }),
    },
    title: {
      id: titleId,
      'data-scope': 'dialog',
      'data-part': 'title',
    },
    description: {
      id: descId,
      'data-scope': 'dialog',
      'data-part': 'description',
    },
    closeTrigger: {
      type: 'button',
      'aria-label': closeLabel,
      'data-scope': 'dialog',
      'data-part': 'close-trigger',
      onClick: tagSend(send, ['close'], () => send({ type: 'close' })),
    },
  }
}

export interface OverlayOptions {
  /** Dialog state slice as a Signal. */
  state: Signal<DialogState>
  /** Send dispatcher for dialog messages. */
  send: Send<DialogMsg>
  /** Parts from `connect()` — used to locate the content element by id. */
  parts: DialogParts
  /** Content rendering. */
  content: () => Renderable
  /**
   * Optional enter/leave transition for the dialog content (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, so the close plays an exit animation.
   * Keep `skipAnimations` at its default (true) when driving exits this way.
   *
   * @example dialog.overlay({ state, send, parts, content, transition: fade({ duration: 150 }) })
   */
  transition?: TransitionOptions
  /** Close on Escape key (default: true). */
  closeOnEscape?: boolean
  /** Close on click outside content (default: true). */
  closeOnOutsideClick?: boolean
  /** Trap focus inside the dialog while open (default: true for modal). */
  trapFocus?: boolean
  /** Lock body scroll while open (default: true for modal). */
  lockScroll?: boolean
  /** Apply aria-hidden to sibling trees (default: true for modal). */
  hideSiblings?: boolean
  /** Target element / selector for the portal (default: 'body'). */
  target?: string | HTMLElement
  /** Element to focus initially (default: first focusable inside content). */
  initialFocus?: Element | (() => Element | null)
  /** Restore focus on close (default: true). */
  restoreFocus?: boolean
}

/**
 * Build the dialog's DOM tree and wire up all accessibility utilities.
 * Returns a `show()` structural block gated on `isMounted(state)` so the node
 * stays mounted through an exit animation (status 'closing') and is removed at
 * animation end; with `skipAnimations` (the default) close unmounts synchronously.
 */
export function overlay(opts: OverlayOptions): Mountable {
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus !== false
  // Two-phase: the outer block stays mounted through the exit animation
  // (isMounted); the interaction phase unwinds at the close REQUEST (isVisible)
  // so focus trap / scroll lock / aria-hidden / dismissable tear down while the
  // node lingers for its exit animation. Ids are resolved against `document`
  // (dialogs always portal to the light-DOM body).
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

export const dialog = { init, update, connect, overlay, isMounted, isPresent }
