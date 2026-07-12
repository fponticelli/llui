import type { Send, Signal, Mountable, Renderable } from '@llui/dom'
import {
  init,
  update,
  isMounted,
  isPresent,
  connect as dialogConnect,
  overlay as dialogOverlay,
  type DialogState,
  type DialogMsg,
  type DialogParts,
  type ConnectOptions as DialogConnectOptions,
} from './dialog.js'

/**
 * Alert dialog — a variant of dialog for destructive confirmations or blocking
 * messages. Uses `role="alertdialog"` and defaults `closeOnOutsideClick: false`
 * so the user must choose an action explicitly.
 *
 * Shares state, messages, and part structure with `dialog` — including the
 * single `closeTrigger` part. There is no dedicated cancel/confirm part: render
 * two buttons in the content and dispatch your own confirm/cancel messages
 * (spread `parts.closeTrigger` onto the cancel button to also close the dialog).
 *
 * ```ts
 * view: ({ state, send }) => {
 *   const parts = alertDialog.connect(state.at('confirm'), send, { id: 'del' })
 *   return [
 *     button({ ...parts.trigger }, [text('Delete')]),
 *     alertDialog.overlay({
 *       state: state.at('confirm'),
 *       send,
 *       parts,
 *       content: () => [
 *         div({ ...parts.content }, [
 *           h2({ ...parts.title }, [text('Delete file?')]),
 *           button({ ...parts.closeTrigger }, [text('Cancel')]),
 *           button({ onClick: () => send({ type: 'confirmDelete' }) }, [text('Delete')]),
 *         ]),
 *       ],
 *     }),
 *   ]
 * }
 * ```
 */

export type { DialogState as AlertDialogState, DialogMsg as AlertDialogMsg }

export { init, update, isMounted, isPresent }

/** Connect options — the dialog options minus `role` (fixed to `alertdialog`). */
export type AlertDialogConnectOptions = Omit<DialogConnectOptions, 'role'>

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

export const alertDialog = { init, update, connect, overlay, isMounted, isPresent }
