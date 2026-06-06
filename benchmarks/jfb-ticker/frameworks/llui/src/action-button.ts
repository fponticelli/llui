// Per-button helper. Buttons are imperative dispatchers (not reactive), and this
// is a HELPER function — the compiler's view transform only rewrites slots inside
// a component `view`, not helper bodies — so it builds DOM with the RUNTIME signal
// helpers (el / staticText) directly rather than the authoring ones.

import { el, staticText, type Mountable } from '@llui/dom'

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
  // When provided, the burst is coalesced into ONE reconcile via the bag's `batch`
  // (the idiomatic streaming path — the `batch-1k` op). Omit it for the forced-sync
  // ops, where each `send` reconciles immediately.
  batch?: (fn: () => void) => void,
): Mountable {
  const msg = { type: msgType } as ButtonMsg
  const dispatch = (): void => {
    for (let i = 0; i < iters; i++) {
      send(msg) // signal send is synchronous — DOM updates immediately
    }
  }
  // Markup must be byte-identical to the other framework implementations:
  // a bare `<button id type class="btn">label</button>` with no wrapper and no
  // extra classes, so the rendered controls row looks the same across frameworks.
  return el(
    'button',
    {
      id,
      type: 'button',
      class: 'btn',
      onClick: batch ? () => batch(dispatch) : dispatch,
    },
    [staticText(label)],
  )
}
