import { describe, it, expect, vi } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { ul, li, text, each } from '../../src/signals/authoring'

// Regression: the keyed `each` reconciler must move the MINIMAL number of rows
// (n − |LIS|), not re-insert in order on every change. The old cursor walk
// degraded to O(n) DOM moves — a 2-row swap moved ~all rows, a single removal
// moved everything after it (jfb swap/remove were ~6×/4× slower than peers).
// These tests pin both CORRECTNESS (final order) and the MOVE COUNT.

interface Row {
  id: number
  label: string
}
interface S {
  rows: Row[]
}
type M = { type: 'set'; rows: Row[] }

function mount(initial: Row[]) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ rows: initial }),
    update: (_s, m) => ({ rows: m.rows }),
    view: ({ state }) => [
      ul([
        each(
          state.map((s) => s.rows),
          {
            key: (r: Row) => r.id,
            render: (item) => [
              li({ id: item.map((r) => `r${r.id}`) }, [text(item.map((r) => r.label))]),
            ],
          },
        ),
      ]),
    ],
  })
  const listEl = container.querySelector('ul')!
  // Spy on the list element's DOM mutations (rows insert/move/remove here);
  // vi.spyOn keeps the real implementation and records call counts.
  const insertSpy = vi.spyOn(listEl, 'insertBefore')
  const removeSpy = vi.spyOn(listEl, 'removeChild')
  const ids = () => [...listEl.querySelectorAll('li')].map((el) => el.id)
  const labels = () => [...listEl.querySelectorAll('li')].map((el) => el.textContent)
  const reset = () => {
    insertSpy.mockClear()
    removeSpy.mockClear()
  }
  return {
    h,
    ids,
    labels,
    reset,
    counts: () => ({ inserts: insertSpy.mock.calls.length, removes: removeSpy.mock.calls.length }),
  }
}

const mk = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `l${i + 1}` }))

describe('keyed each — minimal-move reorder', () => {
  it('swap of two rows is exactly 2 DOM moves (not O(n))', () => {
    const rows = mk(6) // ids 1..6
    const { h, ids, reset, counts } = mount(rows)
    expect(ids()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])

    // swap positions 1 and 4 (ids 2 and 5)
    const swapped = rows.slice()
    ;[swapped[1], swapped[4]] = [swapped[4]!, swapped[1]!]
    reset()
    h.send({ type: 'set', rows: swapped })

    expect(ids()).toEqual(['r1', 'r5', 'r3', 'r4', 'r2', 'r6']) // correct order
    expect(counts().inserts).toBe(2) // only the 2 swapped rows move
    expect(counts().removes).toBe(0)
    h.dispose()
  })

  it('removing one row from the middle is 0 moves + 1 removal', () => {
    const rows = mk(6)
    const { h, ids, reset, counts } = mount(rows)

    const without3 = rows.filter((r) => r.id !== 3)
    reset()
    h.send({ type: 'set', rows: without3 })

    expect(ids()).toEqual(['r1', 'r2', 'r4', 'r5', 'r6'])
    expect(counts().inserts).toBe(0) // survivors keep their DOM positions
    expect(counts().removes).toBe(1) // only the removed row's node
    h.dispose()
  })

  it('reverse of n rows moves n−1 (LIS = 1)', () => {
    const rows = mk(5)
    const { h, ids, reset, counts } = mount(rows)

    const reversed = rows.slice().reverse()
    reset()
    h.send({ type: 'set', rows: reversed })

    expect(ids()).toEqual(['r5', 'r4', 'r3', 'r2', 'r1'])
    expect(counts().inserts).toBe(4) // n − |LIS| = 5 − 1
    h.dispose()
  })

  it('appending rows touches only the new rows (kept rows unmoved)', () => {
    const rows = mk(3)
    const { h, ids, reset, counts } = mount(rows)

    reset()
    h.send({ type: 'set', rows: mk(5) }) // append ids 4,5
    expect(ids()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(counts().inserts).toBe(2) // only the 2 appended
    expect(counts().removes).toBe(0)
    h.dispose()
  })

  it('moving the last row to the front is a single move', () => {
    const rows = mk(5)
    const { h, ids, reset, counts } = mount(rows)

    const moved = [rows[4]!, ...rows.slice(0, 4)]
    reset()
    h.send({ type: 'set', rows: moved })
    expect(ids()).toEqual(['r5', 'r1', 'r2', 'r3', 'r4'])
    expect(counts().inserts).toBe(1) // LIS = [1,2,3,4]; only r5 moves
    h.dispose()
  })

  it('skip-unchanged-rows opt keeps item-only rows correct when only state changes', () => {
    // The reconcile skips scope.update for rows whose item+index are unchanged when
    // the template reads no component state. A state-only change (rows refs stable)
    // must still leave rows correct, and a later item change must still update.
    interface S2 {
      rows: Row[]
      tick: number
    }
    type M2 = { type: 'tick' } | { type: 'set'; rows: Row[] }
    const container = document.createElement('div')
    const rows = mk(3)
    const h = mountSignalComponent<S2, M2>(container, {
      init: () => ({ rows, tick: 0 }),
      update: (s, m) => (m.type === 'tick' ? { ...s, tick: s.tick + 1 } : { ...s, rows: m.rows }),
      // rows read ONLY item.label — no component-state read → skip path active
      view: ({ state }) => [
        ul([
          each(
            state.map((s) => s.rows),
            { key: (r: Row) => r.id, render: (item) => [li([text(item.map((r) => r.label))])] },
          ),
        ]),
      ],
    })
    const labels = () => [...container.querySelectorAll('li')].map((el) => el.textContent)
    expect(labels()).toEqual(['l1', 'l2', 'l3'])

    h.send({ type: 'tick' }) // state changes, row item refs unchanged → rows skipped
    expect(labels()).toEqual(['l1', 'l2', 'l3']) // still correct (no stale/blank)

    // change one item's data (new ref) → that row must re-evaluate
    h.send({ type: 'set', rows: [rows[0]!, { id: 2, label: 'CHANGED' }, rows[2]!] })
    expect(labels()).toEqual(['l1', 'CHANGED', 'l3'])
    h.dispose()
  })

  it('in-place label update moves nothing but still applies reactively (fast path)', () => {
    const rows = mk(4)
    const { h, ids, labels, reset, counts } = mount(rows)
    expect(labels()).toEqual(['l1', 'l2', 'l3', 'l4'])

    const relabeled = rows.map((r) => ({ ...r, label: r.label + '!' }))
    reset()
    h.send({ type: 'set', rows: relabeled })

    expect(ids()).toEqual(['r1', 'r2', 'r3', 'r4']) // same order
    expect(counts().inserts).toBe(0) // fast path: no DOM moves/bookkeeping
    expect(counts().removes).toBe(0)
    // …but per-row bindings still re-ran (phase 1 runs before the fast-path exit)
    expect(labels()).toEqual(['l1!', 'l2!', 'l3!', 'l4!'])
    h.dispose()
  })
})
