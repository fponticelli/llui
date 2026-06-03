import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import {
  init,
  update,
  connect as dialogConnect,
  overlay as dialogOverlay,
  type DialogState,
  type DialogMsg,
  type DialogParts,
  type ConnectOptions as DialogConnectOptions,
} from './dialog.js'

/**
 * Alert dialog — a variant of dialog for destructive confirmations or
 * blocking messages. Uses `role="alertdialog"` and defaults to:
 *   - `closeOnOutsideClick: false` (user must choose an action explicitly)
 *
 * Shares state, messages, and part structure with `dialog`. Render a
 * `cancelTrigger` alongside the `closeTrigger` and let the application
 * dispatch a follow-up action after the dialog closes.
 */

export type { DialogState as AlertDialogState, DialogMsg as AlertDialogMsg }

export { init, update }

export interface AlertDialogConnectOptions extends Omit<DialogConnectOptions, 'role'> {
  /** Accessible label for the cancel button (default: 'Cancel'). */
  cancelLabel?: string
  /** Accessible label for the confirm button (default: 'Confirm'). */
  confirmLabel?: string
}

export type AlertDialogParts = DialogParts

export function connect(
  state: Signal<DialogState>,
  send: Send<DialogMsg>,
  opts: AlertDialogConnectOptions,
): AlertDialogParts {
  return dialogConnect(state, send, { ...opts, role: 'alertdialog' })
}

export interface AlertDialogOverlayOptions {
  state: Signal<DialogState>
  send: Send<DialogMsg>
  parts: AlertDialogParts
  content: () => Renderable
  transition?: TransitionOptions
  closeOnEscape?: boolean
  /** Whether outside-click should dismiss (default: false for alert dialogs). */
  closeOnOutsideClick?: boolean
  trapFocus?: boolean
  lockScroll?: boolean
  hideSiblings?: boolean
  target?: string | HTMLElement
  initialFocus?: Element | (() => Element | null)
  restoreFocus?: boolean
}

export function overlay(opts: AlertDialogOverlayOptions): Mountable {
  return dialogOverlay({
    ...opts,
    closeOnOutsideClick: opts.closeOnOutsideClick ?? false,
  })
}

export const alertDialog = { init, update, connect, overlay }
