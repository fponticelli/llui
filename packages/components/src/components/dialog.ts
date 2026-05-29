import type { Send, Signal, TransitionOptions } from '@llui/dom/signals'
import { show, portal, onMount, div, useContext, tagSend } from '@llui/dom/signals'
import { LocaleContext } from '../locale.js'
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
  /** @intent("Open the dialog") */
  | { type: 'open' }
  /** @intent("Close the dialog") */
  | { type: 'close' }
  /** @intent("Toggle the dialog open/closed") */
  | { type: 'toggle' }
  /** @intent("Set the dialog's open state to a specific value") */
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
    'data-state': Signal<'open' | 'closed'>
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
    'data-state': Signal<'open' | 'closed'>
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
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
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
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
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
  content: () => readonly Node[]
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
 * Returns a `show()` structural block that tracks `state.open`.
 */
export function overlay(opts: OverlayOptions): Node {
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
  const host =
    typeof targetOpt === 'string' ? (document.querySelector(targetOpt) ?? document.body) : targetOpt

  return show(
    opts.state.map((s) => s.open),
    () => [
      portal(() => {
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
      }, host),
    ],
  )
}

export const dialog = { init, update, connect, overlay }
