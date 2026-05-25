// Per-button helper. Lives in its own file so the bench's main.ts can keep
// view-bag primitives behind the view bag (satisfies llui/view-bag-import).
// Buttons are not reactive — they're imperative dispatchers — so static
// analysis on closures here is irrelevant.

import { div, button, text, flush } from '@llui/dom'

type ButtonMsg =
  | { type: 'mount' }
  | { type: 'tick' }
  | { type: 'narrow' }
  | { type: 'toggle' }
  | { type: 'churn' }
  | { type: 'clear' }

export function actionButton(
  id: string,
  label: string,
  msgType: ButtonMsg['type'],
  iters: number,
  send: (msg: ButtonMsg) => void,
): HTMLElement {
  const msg = { type: msgType } as ButtonMsg
  return div({ class: 'btn-wrap' }, [
    button(
      {
        type: 'button',
        class: 'btn btn-primary',
        id,
        onClick: () => {
          for (let i = 0; i < iters; i++) {
            send(msg)
            flush()
          }
        },
      },
      [text(label)],
    ),
  ])
}
