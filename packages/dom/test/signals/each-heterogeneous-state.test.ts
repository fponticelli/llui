import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { ul, li, text, each } from '../../src/signals/authoring'

// Regression: the `each` template probe (needsRebase / templateReadsState /
// stateGatable) is computed ONCE from the first built row and applied to every
// row. A DATA-CONDITIONAL render can make later rows read component state even
// when the first row does not. If the first row's template reads no component
// state, `templateReadsState`/`sweepAll` is false, so a component-state-only
// change (items array unchanged) skips the same-structure fast path's per-row
// update for the unchanged rows — leaving a later state-reading row STALE.
interface Row {
  id: string
  special: boolean
}
interface S {
  rows: readonly Row[]
  label: string
}
type M = { type: 'setLabel'; label: string }

describe('authoring each — heterogeneous rows reading component state', () => {
  it('updates a later state-reading row when the first row reads no state', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({
        // Row 0 is NOT special (renders row-local only); row 1 IS special
        // (renders a component-state read). Same `rows` array ref survives a
        // label-only change, so the fast path sees unchanged items.
        rows: [
          { id: 'a', special: false },
          { id: 'b', special: true },
        ],
        label: 'v1',
      }),
      update: (s, m) => (m.type === 'setLabel' ? { ...s, label: m.label } : s),
      view: ({ state }) => [
        ul([
          each(
            state.map((s) => s.rows),
            {
              key: (r) => r.id,
              render: (item) =>
                item.peek().special
                  ? // Special row reads COMPONENT state (label) — not row-local.
                    [li([text(state.at('label'))])]
                  : // Ordinary row reads only its own item.
                    [li([text(item.map((r) => r.id))])],
            },
          ),
        ]),
      ],
    })

    const lis = () => [...container.querySelectorAll('li')].map((el) => el.textContent)
    expect(lis()).toEqual(['a', 'v1'])

    // Change ONLY the component-state label; the rows array ref is unchanged.
    h.send({ type: 'setLabel', label: 'v2' })

    // The special (state-reading) row must reflect the new label.
    expect(lis()).toEqual(['a', 'v2'])
    h.dispose()
  })
})
