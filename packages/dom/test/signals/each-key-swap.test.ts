import { describe, it, expect } from 'vitest'
import { mountApp, component, div, span, text, each } from '../../src/signals/authoring'

// Regression: a keyed `each` whose ENTIRE row set swaps in one update — the old
// key removed AND a new key added simultaneously (the single-row "epoch bump"
// shape: dicerun's Studio / inline-roll result panel re-keys its one row on
// every roll). The first render is fine; the swap must insert the new row's
// nodes between the anchors. The old (pre-signals) runtime regressed here once
// ("each add-after-remove loses the DOM mutation" — the row collapsed to just
// the boundary comments); this guards the signals runtime against the same.

interface S {
  epoch: number
}
type M = { type: 'bump' }

describe('each: single-row key swap (remove old + add new in one update)', () => {
  function setup() {
    const container = document.createElement('div')
    const h = mountApp<S, M>(
      container,
      component<S, M>({
        init: () => ({ epoch: 1 }),
        update: (s) => ({ epoch: s.epoch + 1 }),
        view: ({ state }) => [
          div({ id: 'list' }, [
            each(
              state.map((s) => [{ epoch: s.epoch }]),
              {
                key: (r) => r.epoch,
                render: (item) => [div({ class: 'row' }, [text(item.map((r) => `e${r.epoch}`))])],
              },
            ),
          ]),
        ],
      }),
    )
    return { h, container }
  }

  it('renders the new row content after each key swap (not just anchors)', () => {
    const { h, container } = setup()
    const rows = () => [...container.querySelectorAll('#list .row')].map((r) => r.textContent)
    expect(rows()).toEqual(['e1'])
    h.send({ type: 'bump' })
    expect(rows()).toEqual(['e2']) // roll #2 — the historically-empty case
    h.send({ type: 'bump' })
    expect(rows()).toEqual(['e3']) // roll #3
    h.dispose()
  })
})

// The dicerun Studio / inline-roll result panel is exactly this shape: an OUTER
// epoch-keyed `each` of a single row, whose row body is a `display:contents`
// wrapper around an INNER `each` (the per-die / per-segment list). Rolling
// re-keys the outer row; the new row must rebuild AND its nested each must mount
// its own rows. The symptom was: roll #1 renders, roll #2+ leaves the panel
// empty (`.rolled-expr` count 0) even though state was correct.
describe('each: single-row outer key swap whose row contains a nested each', () => {
  interface NS {
    epoch: number
    items: string[]
  }
  type NM = { type: 'reroll' }

  function setup() {
    const container = document.createElement('div')
    const h = mountApp<NS, NM>(
      container,
      component<NS, NM>({
        init: () => ({ epoch: 1, items: ['a', 'b'] }),
        // A re-roll bumps the epoch (re-keys the outer row) and produces fresh
        // item values, mirroring a dice roll.
        update: (s) => ({ epoch: s.epoch + 1, items: [`x${s.epoch + 1}`, `y${s.epoch + 1}`] }),
        view: ({ state }) => [
          div({ id: 'panel' }, [
            each(
              state.map((s) => [{ epoch: s.epoch, items: s.items }]),
              {
                key: (r) => r.epoch,
                // row body: a display:contents wrapper around a NESTED each over
                // the row item's list — the rolledExprView / diceRollView shape.
                render: (item) => [
                  div({ style: 'display:contents' }, [
                    each(
                      item.map((r) => r.items),
                      {
                        key: (s) => s,
                        render: (cell) => [span({ class: 'cell' }, [text(cell)])],
                      },
                    ),
                  ]),
                ],
              },
            ),
          ]),
        ],
      }),
    )
    return { h, container }
  }

  it('rebuilds the nested each content after each outer key swap', () => {
    const { h, container } = setup()
    const cells = () => [...container.querySelectorAll('#panel .cell')].map((c) => c.textContent)
    expect(cells()).toEqual(['a', 'b'])
    h.send({ type: 'reroll' }) // roll #2 — historically empty
    expect(cells()).toEqual(['x2', 'y2'])
    h.send({ type: 'reroll' }) // roll #3
    expect(cells()).toEqual(['x3', 'y3'])
    h.dispose()
  })
})

// The PRECISE Studio shape: rolling clears the value first (an intermediate
// value-null epoch row that renders a DIFFERENT body — diceRollView, no nested
// each), then sets the value (a new epoch row that renders the nested-each body
// — rolledExprView). So per roll the outer each swaps its single row TWICE, and
// the two rows have DIFFERENT structures. The final (value-present) row's nested
// each rendered empty in Studio. This drives a row whose body shape switches
// between swaps.
describe('each: single-row swap where row body shape changes (empty ↔ nested each)', () => {
  interface VS {
    epoch: number
    // null mimics the value-null intermediate (renders a plain element, no
    // nested each); non-null mimics the value-present row (nested each).
    items: string[] | null
  }
  // bump = clear (value-null intermediate), then a second bump sets items.
  type VM = { type: 'clear' } | { type: 'fill'; items: string[] }

  function setup() {
    const container = document.createElement('div')
    const h = mountApp<VS, VM>(
      container,
      component<VS, VM>({
        init: () => ({ epoch: 1, items: ['a', 'b'] }),
        update: (s, m) =>
          m.type === 'clear'
            ? { epoch: s.epoch + 1, items: null }
            : { epoch: s.epoch + 1, items: m.items },
        view: ({ state }) => [
          div({ id: 'panel' }, [
            each(
              state.map((s) => [{ epoch: s.epoch, items: s.items }]),
              {
                key: (r) => r.epoch,
                render: (item) => {
                  const r = item.peek()
                  // value-null → a plain marker element (the diceRollView branch)
                  if (r.items === null) return [div({ class: 'empty' }, [text('rolling')])]
                  // value-present → a display:contents-wrapped nested each
                  return [
                    div({ style: 'display:contents' }, [
                      each(
                        item.map((x) => x.items ?? []),
                        {
                          key: (s) => s,
                          render: (cell) => [span({ class: 'cell' }, [text(cell)])],
                        },
                      ),
                    ]),
                  ]
                },
              },
            ),
          ]),
        ],
      }),
    )
    return { h, container }
  }

  it('shows the nested-each content after a clear→fill double swap (per roll)', () => {
    const { h, container } = setup()
    const cells = () => [...container.querySelectorAll('#panel .cell')].map((c) => c.textContent)
    expect(cells()).toEqual(['a', 'b'])
    // roll #2: clear (value-null intermediate) then fill (value present)
    h.send({ type: 'clear' })
    h.send({ type: 'fill', items: ['x2', 'y2'] })
    expect(cells()).toEqual(['x2', 'y2'])
    // roll #3
    h.send({ type: 'clear' })
    h.send({ type: 'fill', items: ['x3', 'y3'] })
    expect(cells()).toEqual(['x3', 'y3'])
    h.dispose()
  })
})

// The full dicerun rolledExprView depth: THREE nested eaches. L1 = the outer
// epoch each (single row). L2 = an each whose ITEMS derive from the L1 row item
// (`item.map(r => bakedNodes)`); its row renders a div whose CLASS is read from
// the L2 item (`item.map(n => n.cls)` → ".rolled-expr") and which contains L3 =
// an each over the L2 item's children. Studio's clear→fill double-swap left this
// rendering `out=1` baked node yet zero `.rolled-expr` in the DOM — so the L2
// row's class binding / L3 each did not materialise after the swap.
describe('each: 3-level nesting — L2 row class+each read the L2 item, swapped via L1', () => {
  interface DS {
    epoch: number
    cls: string
    children: string[]
  }
  type DM = { type: 'clear' } | { type: 'fill'; cls: string; children: string[] }

  function setup() {
    const container = document.createElement('div')
    const h = mountApp<DS, DM>(
      container,
      component<DS, DM>({
        init: () => ({ epoch: 1, cls: 'rolled-expr r1', children: ['a', 'b'] }),
        update: (s, m) =>
          m.type === 'clear'
            ? { epoch: s.epoch + 1, cls: '', children: [] }
            : { epoch: s.epoch + 1, cls: m.cls, children: m.children },
        view: ({ state }) => [
          div({ id: 'root' }, [
            // L1: outer epoch each
            each(
              state.map((s) => [{ epoch: s.epoch, cls: s.cls, children: s.children }]),
              {
                key: (r) => r.epoch,
                render: (l1item) => [
                  div({ style: 'display:contents' }, [
                    // L2: items derive from the L1 row item — one "baked node"
                    each(
                      l1item.map((r) => [{ cls: r.cls, children: r.children }]),
                      {
                        key: (n) => n.cls || 'empty',
                        // L2 row: class read from the L2 item + an L3 each
                        render: (l2item) => [
                          div({ class: l2item.map((n) => n.cls) }, [
                            each(
                              l2item.map((n) => n.children),
                              {
                                key: (c) => c,
                                render: (cell) => [span({ class: 'cell' }, [text(cell)])],
                              },
                            ),
                          ]),
                        ],
                      },
                    ),
                  ]),
                ],
              },
            ),
          ]),
        ],
      }),
    )
    return { h, container }
  }

  it('materialises the L2 class + L3 cells after a clear→fill double swap', () => {
    const { h, container } = setup()
    const rolledExpr = () => container.querySelectorAll('#root .rolled-expr').length
    const cells = () => [...container.querySelectorAll('#root .cell')].map((c) => c.textContent)
    expect(rolledExpr()).toBe(1)
    expect(cells()).toEqual(['a', 'b'])
    h.send({ type: 'clear' })
    h.send({ type: 'fill', cls: 'rolled-expr r2', children: ['x2', 'y2'] })
    expect(rolledExpr()).toBe(1) // historically 0 — the .rolled-expr div vanished
    expect(cells()).toEqual(['x2', 'y2'])
    h.dispose()
  })
})
