import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div, useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'
import { pushFocusTrap } from '../utils/focus-trap.js'
import { pushDismissable } from '../utils/dismissable.js'
import { setAriaHiddenOutside } from '../utils/aria-hidden.js'
import { lockBodyScroll } from '../utils/remove-scroll.js'

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
 * const parts = dialog.connect<State>(s => s.confirm, sendDialog, { id: 'confirm' })
 *
 * view: (send) => [
 *   button({ ...parts.trigger, class: 'btn' }, [text('Delete')]),
 *   ...dialog.overlay({
 *     get: s => s.confirm,
 *     send: sendDialog,
 *     parts,
 *     content: () => [
 *       div({ ...parts.content, class: 'dialog' }, [
 *         h2({ ...parts.title }, [text('Are you sure?')]),
 *         button({ ...parts.closeTrigger, class: 'btn' }, [text('Cancel')]),
 *       ]),
 *     ],
 *     transition: fade({ duration: 150 }),
 *   }),
 * ]
 * ```
 */

export interface DialogState {
  open: boolean
}

export type DialogMsg =
  /** @intent("Open") */
  | { type: 'open' }
  /** @intent("Close") */
  | { type: 'close' }
  /** @intent("Toggle") */
  | { type: 'toggle' }
  /** @intent("Set Open") */
  | { type: 'setOpen'; open: boolean }

export interface DialogInit {
  open?: boolean
}

export function init(opts: DialogInit = {}): DialogState {
  return { open: opts.open ?? false }
}

export function update(state: DialogState, msg: DialogMsg): [DialogState, never[]] {
  switch (msg.type) {
    case 'open':
      return [{ ...state, open: true }, []]
    case 'close':
      return [{ ...state, open: false }, []]
    case 'toggle':
      return [{ ...state, open: !state.open }, []]
    case 'setOpen':
      return [{ ...state, open: msg.open }, []]
  }
}

export interface DialogParts<S> {
  trigger: {
    type: 'button'
    'aria-haspopup': 'dialog'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    id: string
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'dialog'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  backdrop: {
    'data-state': (s: S) => 'open' | 'closed'
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
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'dialog'
    'data-part': 'content'
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
    'aria-label': string | ((s: S) => string)
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

export function connect<S>(
  get: (s: S) => DialogState,
  send: Send<DialogMsg>,
  opts: ConnectOptions,
): DialogParts<S> {
  const base = opts.id
  const contentId = `${base}:content`
  const titleId = `${base}:title`
  const descId = `${base}:description`
  const triggerId = `${base}:trigger`
  const role = opts.role ?? 'dialog'
  const modal = opts.modal !== false
  const locale = useContext<S, Locale>(LocaleContext)
  const closeLabel: string | ((s: S) => string) =
    opts.closeLabel ?? ((s: S) => locale(s).dialog.close)

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      id: triggerId,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'dialog',
      'data-part': 'trigger',
      onClick: () => send({ type: 'open' }),
    },
    backdrop: {
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
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
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'dialog',
      'data-part': 'content',
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
      onClick: () => send({ type: 'close' }),
    },
  }
}

export interface OverlayOptions<S> {
  /** State accessor. */
  get: (s: S) => DialogState
  /** Send dispatcher for dialog messages. */
  send: Send<DialogMsg>
  /** Parts from `connect()` — used to locate the content element by id. */
  parts: DialogParts<S>
  /** Content rendering. */
  content: () => Node[]
  /** Optional transition to apply on open/close (from `@llui/transitions`). */
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
 * Returns a `show()` structural block that tracks `get(state).open`.
 */
export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
  const closeOnEscape = opts.closeOnEscape !== false
  const closeOnOutsideClick = opts.closeOnOutsideClick !== false
  const trapFocus = opts.trapFocus !== false
  const lockScroll = opts.lockScroll !== false
  const hideSiblings = opts.hideSiblings !== false
  const restoreFocus = opts.restoreFocus !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show<S, DialogMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
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
          })
          return [div(parts.positioner, opts.content())]
        },
      }),
    enter: opts.transition?.enter,
    leave: opts.transition?.leave,
  })
}

export const dialog = { init, update, connect, overlay }
