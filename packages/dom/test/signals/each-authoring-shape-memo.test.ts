import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text, each } from '../../src/signals/authoring'

// The authoring (render-callback) `each` memoizes the per-template scope shape
// (PathTable + masks) across rows, guarded by a per-row deps-signature compare. This
// regression-tests the FALLBACK: a DATA-CONDITIONAL render whose rows carry DIFFERENT
// deps must NOT reuse the first row's shape — each row has to react to its own paths.

interface Row {
  id: number
  kind: 'a' | 'b'
  av: string
  bv: string
}
type S = { rows: Row[] }
type M = { type: 'set'; rows: Row[] }

function setup(initial: Row[]) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => [{ rows: initial }, []],
    update: (_s, m) => [{ rows: m.rows }, []],
    // Uncompiled authoring each — exercises the runtime row-build + scope-shape memo.
    // Rows of kind 'a' read item.av; kind 'b' read item.bv → different per-row deps.
    view: ({ state }) => [
      div({}, [
        each<Row>(state.at('rows'), {
          key: (r) => r.id,
          render: (item) =>
            item.peek().kind === 'a'
              ? [div({ class: 'a' }, [span({}, [text(item.at('av'))])])]
              : [div({ class: 'b' }, [span({}, [text(item.at('bv'))])])],
        }),
      ]),
    ],
  })
  const cells = (): string[] =>
    [...container.querySelectorAll('span')].map((s) => s.textContent ?? '')
  const classes = (): string[] => [...container.querySelectorAll('.a, .b')].map((e) => e.className)
  return { h, cells, classes }
}

describe('authoring each — scope-shape memo fallback for data-conditional rows', () => {
  it('rows with different shapes each react to their OWN deps (no cross-applied masks)', () => {
    const { h, cells, classes } = setup([
      { id: 1, kind: 'a', av: 'a1', bv: 'x' },
      { id: 2, kind: 'b', av: 'x', bv: 'b1' },
      { id: 3, kind: 'a', av: 'a2', bv: 'x' },
    ])
    expect(classes()).toEqual(['a', 'b', 'a'])
    expect(cells()).toEqual(['a1', 'b1', 'a2'])

    // update the 'b' row's bv — only it should change (its mask reads bv, not av)
    h.send({
      type: 'set',
      rows: [
        { id: 1, kind: 'a', av: 'a1', bv: 'x' },
        { id: 2, kind: 'b', av: 'x', bv: 'B1!' },
        { id: 3, kind: 'a', av: 'a2', bv: 'x' },
      ],
    })
    expect(cells()).toEqual(['a1', 'B1!', 'a2'])

    // update an 'a' row's av — only it should change
    h.send({
      type: 'set',
      rows: [
        { id: 1, kind: 'a', av: 'A1!', bv: 'x' },
        { id: 2, kind: 'b', av: 'x', bv: 'B1!' },
        { id: 3, kind: 'a', av: 'a2', bv: 'x' },
      ],
    })
    expect(cells()).toEqual(['A1!', 'B1!', 'a2'])
  })
})
