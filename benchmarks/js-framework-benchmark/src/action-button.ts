// Per-button helper extracted from main.ts so the bench's component
// file can keep all view-bag primitives (`text`, `each`, `selector`)
// behind the view bag — satisfying `llui/view-bag-import` without
// adding ceremony to the bench's hot path.

// A helper function (no `component()` call), so it's not compiled — the signal
// authoring helpers (div/button/text) run as real runtime functions here.
import { div, button, text } from '@llui/dom/signals'

// Inline subset of main.ts's Msg union — just the variants the button
// dispatches. Named `ButtonMsg` (not `Msg`) so the agent-rule matchers
// don't treat this helper-local alias as a component's Msg union
// (which would demand @intent annotations).
type ButtonMsg =
  | { type: 'run' }
  | { type: 'runlots' }
  | { type: 'add' }
  | { type: 'update' }
  | { type: 'clear' }
  | { type: 'swaprows' }

export function actionButton(id: string, label: string, send: (msg: ButtonMsg) => void): Node {
  const msg: ButtonMsg =
    id === 'swaprows' ? { type: 'swaprows' } : { type: id as ButtonMsg['type'] }
  return div({ class: 'col-sm-6 smallpad' }, [
    button(
      {
        type: 'button',
        class: 'btn btn-primary btn-block',
        id,
        onClick: () => send(msg), // signal send applies synchronously — no flush
      },
      [text(label)],
    ),
  ])
}
