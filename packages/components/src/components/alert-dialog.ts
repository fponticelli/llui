import type { Send, TransitionOptions } from '@llui/dom'
import {
  init,
  update,
  connect as dialogConnect,
  overlay as dialogOverlay,
  type DialogState,
  type DialogMsg,
  type DialogParts,
  type ConnectOptions as DialogConnectOptions,
} from './dialog'

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

export type AlertDialogParts<S> = DialogParts<S>

export function connect<S>(
  get: (s: S) => DialogState,
  send: Send<DialogMsg>,
  opts: AlertDialogConnectOptions,
): AlertDialogParts<S> {
  return dialogConnect(get, send, { ...opts, role: 'alertdialog' })
}

export interface AlertDialogOverlayOptions<S> {
  get: (s: S) => DialogState
  send: Send<DialogMsg>
  parts: AlertDialogParts<S>
  content: () => Node[]
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

export function overlay<S>(opts: AlertDialogOverlayOptions<S>): Node[] {
  return dialogOverlay({
    ...opts,
    closeOnOutsideClick: opts.closeOnOutsideClick ?? false,
  })
}

export const alertDialog = { init, update, connect, overlay }
