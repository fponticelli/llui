// The link editor — a modal dialog (built on the @llui/components `dialog`) for
// entering/editing a URL. Driven by the editor's `ui.linkDialog` + `ui.linkUrl`
// state; submitting dispatches `submitLink`, which the editor applies to the
// saved selection.

import { button, div, input, text, type Mountable, type Send, type Signal } from '@llui/dom'
import {
  connect as connectDialog,
  overlay as overlayDialog,
  type DialogMsg,
  type DialogState,
} from '@llui/components/dialog'
import type { EditorMsg } from '../state.js'

export interface LinkDialogOptions {
  /** `state.at('ui.linkDialog')` — the `{ open }` slice. */
  dialog: Signal<DialogState>
  /** `state.at('ui.linkUrl')` — the URL input value. */
  url: Signal<string>
  send: Send<EditorMsg>
  /** Dialog instance id for ARIA wiring (default 'md-link-dialog'). */
  id?: string
}

/** Render the link dialog. Hidden (portal, nothing inline) until `dialog.open`. */
export function linkDialog(opts: LinkDialogOptions): Mountable {
  const dialogSend: Send<DialogMsg> = (msg) => opts.send({ type: 'linkDialog', msg })
  const parts = connectDialog(opts.dialog, dialogSend, {
    id: opts.id ?? 'md-link-dialog',
    closeLabel: 'Cancel',
  })

  return overlayDialog({
    state: opts.dialog,
    send: dialogSend,
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
          onInput: (e: Event) =>
            opts.send({ type: 'setLinkUrl', url: (e.target as HTMLInputElement).value }),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              opts.send({ type: 'submitLink' })
            }
          },
        }),
        div({ 'data-md-link': 'actions' }, [
          button({ ...parts.closeTrigger, 'data-md-link': 'cancel' }, [text('Cancel')]),
          button(
            {
              type: 'button',
              'data-md-link': 'apply',
              onClick: () => opts.send({ type: 'submitLink' }),
            },
            [text('Apply')],
          ),
        ]),
      ]),
    ],
  })
}
