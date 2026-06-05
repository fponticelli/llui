// The link editor — a modal dialog (built on the @llui/components `dialog`) for
// entering/editing a URL. Pure view: it's driven by `{ open }` + `url` signals
// and reports changes through callbacks, so any owner (the link plugin) can wire
// it to its own messages.

import { button, div, input, text, type Mountable, type Signal } from '@llui/dom'
import {
  connect as connectDialog,
  overlay as overlayDialog,
  type DialogMsg,
  type DialogState,
} from '@llui/components/dialog'

export interface LinkDialogOptions {
  /** The `{ open }` slice driving the modal. */
  dialog: Signal<DialogState>
  /** The URL input value. */
  url: Signal<string>
  /** Called as the user edits the URL. */
  onInput: (url: string) => void
  /** Called on Apply / Enter. */
  onSubmit: () => void
  /** Called when the dialog requests open/close (dismiss, close button). */
  onDialog: (msg: DialogMsg) => void
  /** Dialog instance id for ARIA wiring (default 'md-link-dialog'). */
  id?: string
}

/** Render the link dialog. Hidden (portal, nothing inline) until `dialog.open`. */
export function linkDialog(opts: LinkDialogOptions): Mountable {
  const parts = connectDialog(opts.dialog, opts.onDialog, {
    id: opts.id ?? 'md-link-dialog',
    closeLabel: 'Cancel',
  })

  return overlayDialog({
    state: opts.dialog,
    send: opts.onDialog,
    parts,
    closeOnEscape: true,
    closeOnOutsideClick: true,
    content: () => [
      div({ ...parts.content, 'data-md-link': 'box' }, [
        div({ ...parts.title, 'data-md-link': 'title' }, [text('Insert link')]),
        input({
          'data-md-link': 'input',
          type: 'url',
          placeholder: 'https://example.com',
          value: opts.url,
          onInput: (e: Event) => opts.onInput((e.target as HTMLInputElement).value),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              opts.onSubmit()
            }
          },
        }),
        div({ 'data-md-link': 'actions' }, [
          button({ ...parts.closeTrigger, 'data-md-link': 'cancel' }, [text('Cancel')]),
          button({ type: 'button', 'data-md-link': 'apply', onClick: () => opts.onSubmit() }, [
            text('Apply'),
          ]),
        ]),
      ]),
    ],
  })
}
