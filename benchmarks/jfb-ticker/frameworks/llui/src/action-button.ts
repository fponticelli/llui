// Per-button helper. Buttons are imperative dispatchers (not reactive), and this
// is a HELPER function — the compiler's view transform only rewrites slots inside
// a component `view`, not helper bodies — so it builds DOM with the RUNTIME signal
// helpers (el / staticText) directly rather than the authoring ones.

import { el, staticText } from '@llui/dom/signals'
import { flush } from '@llui/dom'

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
): Node {
  const msg = { type: msgType } as ButtonMsg
  return el('div', { class: 'btn-wrap' }, [
    el(
      'button',
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
      [staticText(label)],
    ),
  ])
}
