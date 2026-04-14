import type { Send, TransitionOptions } from '@llui/dom'
import { button, text, div, h2, p } from '@llui/dom'
import {
  init as dialogInit,
  update as dialogUpdate,
  connect as dialogConnect,
  overlay as dialogOverlay,
  type DialogParts,
} from '../components/dialog.js'

/**
 * ConfirmDialog — a pre-wired dialog pattern for confirmations.
 *
 * Composes `dialog` with conventional content: title, description, cancel,
 * confirm. Carries an opaque `tag` so the consumer's update handler can
 * recognize which confirmation resolved.
 *
 * Usage in consumer's update:
 *
 * ```ts
 * case 'confirm': {
 *   const [s, fx] = confirmDialog.update(state.confirm, msg.msg)
 *   // When the user clicks confirm, branch on the tag:
 *   if (msg.msg.type === 'confirm') {
 *     switch (state.confirm.tag) {
 *       case 'delete-user': return [{ ...state, confirm: s, users: ... }, fx]
 *       case 'logout': return [{ ...state, confirm: s }, [...fx, logoutEffect]]
 *     }
 *   }
 *   return [{ ...state, confirm: s }, fx]
 * }
 * ```
 */

export interface ConfirmDialogState {
  open: boolean
  tag: string
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  destructive: boolean
}

export type ConfirmDialogMsg =
  | {
      type: 'openWith'
      tag: string
      title: string
      description?: string
      confirmLabel?: string
      cancelLabel?: string
      destructive?: boolean
    }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'setOpen'; open: boolean }

export interface ConfirmDialogInit {
  tag?: string
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export function init(opts: ConfirmDialogInit = {}): ConfirmDialogState {
  return {
    open: false,
    tag: opts.tag ?? '',
    title: opts.title ?? '',
    description: opts.description ?? '',
    confirmLabel: opts.confirmLabel ?? 'Confirm',
    cancelLabel: opts.cancelLabel ?? 'Cancel',
    destructive: opts.destructive ?? false,
  }
}

export function update(
  state: ConfirmDialogState,
  msg: ConfirmDialogMsg,
): [ConfirmDialogState, never[]] {
  switch (msg.type) {
    case 'openWith':
      return [
        {
          ...state,
          open: true,
          tag: msg.tag,
          title: msg.title,
          description: msg.description ?? '',
          confirmLabel: msg.confirmLabel ?? state.confirmLabel,
          cancelLabel: msg.cancelLabel ?? state.cancelLabel,
          destructive: msg.destructive ?? false,
        },
        [],
      ]
    case 'confirm':
      return [{ ...state, open: false }, []]
    case 'cancel':
      return [{ ...state, open: false }, []]
    case 'setOpen':
      return [{ ...state, open: msg.open }, []]
  }
}

/**
 * View the ConfirmDialog. Returns a `show`-wrapped tree that appears when
 * the dialog is open, renders default content (title/description/buttons).
 * Uses role="alertdialog" for destructive confirms.
 */
export interface ConfirmDialogViewOptions<S> {
  get: (s: S) => ConfirmDialogState
  send: Send<ConfirmDialogMsg>
  id: string
  transition?: TransitionOptions
  /** Custom class for content root. */
  contentClass?: string
  /** Custom class for destructive confirm button. */
  destructiveClass?: string
}

export function view<S>(opts: ConfirmDialogViewOptions<S>): Node[] {
  // Build dialog parts — role='alertdialog' for proper modal semantics.
  // Trigger + closeTrigger parts are unused (we provide our own buttons);
  // their send is a no-op.
  const parts: DialogParts<S> = dialogConnect<S>(
    (s) => ({ open: opts.get(s).open }),
    () => {
      /* unused — our buttons dispatch directly via opts.send */
    },
    { id: opts.id, role: 'alertdialog', closeLabel: 'Cancel' },
  )

  return dialogOverlay<S>({
    get: (s) => ({ open: opts.get(s).open }),
    // Dismissable (Esc/outside-click) dispatches dialog.close, which we
    // translate into confirm-dialog.cancel.
    send: (m) => {
      if (m.type === 'close') opts.send({ type: 'cancel' })
    },
    parts,
    content: () => [
      div({ ...parts.content, class: opts.contentClass ?? 'confirm-dialog' }, [
        h2({ ...parts.title }, [text((s: S) => opts.get(s).title)]),
        p({ ...parts.description }, [text((s: S) => opts.get(s).description)]),
        div({ class: 'confirm-dialog__actions' }, [
          button(
            {
              type: 'button',
              class: 'btn btn-secondary',
              onClick: () => opts.send({ type: 'cancel' }),
            },
            [text((s: S) => opts.get(s).cancelLabel)],
          ),
          button(
            {
              type: 'button',
              class: (s: S) =>
                opts.get(s).destructive
                  ? (opts.destructiveClass ?? 'btn btn-danger')
                  : 'btn btn-primary',
              onClick: () => opts.send({ type: 'confirm' }),
            },
            [text((s: S) => opts.get(s).confirmLabel)],
          ),
        ]),
      ]),
    ],
    transition: opts.transition,
    closeOnOutsideClick: false, // alertdialog default
  })
}

/** Helper to create an openWith message builder. */
export function openWith(
  tag: string,
  opts: {
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
  },
): ConfirmDialogMsg {
  return {
    type: 'openWith',
    tag,
    title: opts.title,
    description: opts.description,
    confirmLabel: opts.confirmLabel,
    cancelLabel: opts.cancelLabel,
    destructive: opts.destructive,
  }
}

export const confirmDialog = { init, update, view, openWith }

// Re-exported dialog primitives (available for advanced use cases)
export { dialogInit, dialogUpdate }
