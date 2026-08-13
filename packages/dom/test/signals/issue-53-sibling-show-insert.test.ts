import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { ul, li, span, text, each, show, button } from '../../src/signals/authoring'
import type { Renderable, Mountable } from '../../src/signals/dom'
import type { Signal } from '../../src/signals/types'

// Issue #53 — "a show() insert inside an each row can be lost when a sibling
// show() removes nodes in the same commit" (reported against @llui/dom@0.11.5,
// from a real app: the row lost its badge while the sibling correctly removed its
// buttons, leaving a state the data cannot represent).
//
// It is the SAME defect as issue #52 (structural bindings must skip the
// output-equality check, fixed in 0.12.1) seen from its other side, and the shape
// below is what makes it look like a two-`show` disagreement:
//
//   badge:   show(item.at('corrected'))        → PRECISE dep `item.corrected`
//   actions: show(item.map(r => !r.corrected)) → COARSE dep `item`
//
// `each` recycles TWO ctx buffers per row and rotates them on every row update,
// while a binding's `last[i]` advances only when it COMMITS. The coarse sibling is
// dirty on every row update, so its slot tracks the rotation and it never
// desynchronises. The precise one is GATED OUT by any update that doesn't touch
// `corrected` — after an ODD number of those, its identity `produce` returns the
// very buffer sitting in `last[i]`, so the output-equality check suppressed the
// commit that should have mounted the badge. Hence: buttons removed, badge never
// inserted, and an attribute bound to the SAME signal reading the new value
// (a value binding compares its real output, so it was never affected).
//
// Parity is why the app saw it as a ~20% intermittent: the number of intervening
// state folds before the flip depended on network timing.

interface Row {
  key: string
  value: string
  corrected: boolean
}
interface S {
  rows: Record<string, Row>
}
type M = { type: 'value'; key: string; value: string } | { type: 'correct'; key: string }

/** Re-derived per read, like a real projection — fresh row objects every time. */
function rows(s: S): Row[] {
  return Object.values(s.rows)
    .map((r) => ({ ...r }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

function view(state: Signal<S>): Mountable {
  return ul([
    each(
      state.map((s) => rows(s)),
      {
        key: (r) => r.key,
        render: (item: Signal<Row>): Renderable => [
          li(
            {
              'data-testid': 'row',
              'data-key': item.at('key'),
              // The reporter's discriminating probe: a VALUE binding on the same
              // signal as the badge's `show`.
              'data-probe': item.at('corrected').map((c) => (c ? 'yes' : 'no')),
            },
            [
              span({ 'data-testid': 'value' }, [text(item.at('value'))]),
              show(item.at('corrected'), () => [
                span({ 'data-testid': 'badge' }, [text('Corrected')]),
              ]),
              show(
                item.map((r) => !r.corrected),
                () => [button({ 'data-testid': 'action' }, [text('Correct')])],
              ),
            ],
          ),
        ],
      },
    ),
  ])
}

function mount(initial: Record<string, Row>): {
  host: HTMLElement
  send: (m: M) => void
  dispose: () => void
} {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const handle = mountSignalComponent<S, M, never>(host, {
    name: 'issue53',
    init: () => [{ rows: initial }, []],
    update: (s, m) => {
      const r = s.rows[m.key]
      if (!r) return [s, []]
      const next = m.type === 'value' ? { ...r, value: m.value } : { ...r, corrected: true }
      return [{ rows: { ...s.rows, [m.key]: next } }, []]
    },
    view: ({ state }) => [view(state)],
  })
  return {
    host,
    send: handle.send,
    dispose: () => {
      handle.dispose()
      host.remove()
    },
  }
}

/** The row's rendered state, as the reporter sampled it. */
function snapshot(host: HTMLElement, key = 'k1'): string {
  const row = host.querySelector(`[data-key="${key}"]`)!
  return [
    `probe=${row.getAttribute('data-probe')}`,
    `badge=${row.querySelectorAll('[data-testid="badge"]').length}`,
    `actions=${row.querySelectorAll('[data-testid="action"]').length}`,
  ].join(' ')
}

const ROW = (key: string): Row => ({ key, value: 'v0', corrected: false })

describe('issue #53 — a show() insert lost next to a sibling show() removal', () => {
  // The failure needs an ODD number of intervening row updates that do NOT dirty
  // the precise cond's path — each rotates the row's two recycled ctx buffers
  // while the gated-out binding's `last` slot stands still.
  for (const intervening of [0, 1, 2, 3, 4, 5]) {
    it(`flips both siblings after ${intervening} unrelated row update(s)`, () => {
      const app = mount({ k1: ROW('k1') })
      expect(snapshot(app.host)).toBe('probe=no badge=0 actions=1')
      for (let i = 0; i < intervening; i++) app.send({ type: 'value', key: 'k1', value: `v${i}` })
      expect(snapshot(app.host)).toBe('probe=no badge=0 actions=1')
      app.send({ type: 'correct', key: 'k1' })
      expect(snapshot(app.host)).toBe('probe=yes badge=1 actions=0')
      app.dispose()
    })
  }

  it('holds for every row of a multi-row list, whatever its update parity', () => {
    const app = mount({ k1: ROW('k1'), k2: ROW('k2'), k3: ROW('k3') })
    // Give each row a different number of unrelated updates, so their buffer
    // rotations land on different parities before the flip.
    app.send({ type: 'value', key: 'k2', value: 'a' })
    app.send({ type: 'value', key: 'k3', value: 'a' })
    app.send({ type: 'value', key: 'k3', value: 'b' })
    for (const k of ['k1', 'k2', 'k3']) {
      app.send({ type: 'correct', key: k })
      expect(snapshot(app.host, k)).toBe('probe=yes badge=1 actions=0')
    }
    app.dispose()
  })

  it('survives a click on the button the sibling removes (blur re-enters send)', () => {
    const app = mount({ k1: ROW('k1') })
    app.send({ type: 'value', key: 'k1', value: 'v1' }) // odd parity
    const btn = app.host.querySelector('[data-testid="action"]') as HTMLElement
    btn.addEventListener('blur', () => app.send({ type: 'value', key: 'k1', value: 'blurred' }))
    btn.focus()
    app.send({ type: 'correct', key: 'k1' })
    expect(snapshot(app.host)).toBe('probe=yes badge=1 actions=0')
    app.dispose()
  })
})
