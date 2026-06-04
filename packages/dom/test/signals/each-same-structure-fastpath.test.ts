import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalEach, type RowCtx } from '../../src/signals/dom'

// The same-structure fast path in buildSignalEach: when a reconcile sees the same
// length and every CHANGED position keeps its key, it updates only the changed
// rows (skipping the O(n) keyed scan) and falls back to the full keyed reconcile
// the moment a key moves or n changes. These assert it stays correct across the
// streaming-tick pattern (the ticker burst-1k / tick-100 case) interleaved with
// structural changes that must bail.

interface Row {
  id: number
  v: string
}
interface S {
  rows: Row[]
}
type M = { type: 'set'; rows: Row[] }

function setup(initial: Row[]) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ rows: initial }),
    update: (_s, m) => ({ rows: m.rows }),
    view: () => [
      el('ul', {}, [
        signalEach<Row>(
          { items: (s) => (s as S).rows, deps: ['rows'] },
          (r) => r.id,
          () => [el('li', {}, [signalText((ctx) => (ctx as RowCtx<Row>).item.v, ['item.v'])])],
        ),
      ]),
    ],
  })
  const ul = container.querySelector('ul')!
  const vals = (): string[] => [...ul.querySelectorAll('li')].map((li) => li.textContent ?? '')
  const nodes = (): Element[] => [...ul.querySelectorAll('li')]
  return { h, vals, nodes }
}

describe('signalEach — same-structure fast path', () => {
  it('in-place value updates reuse nodes and update only changed rows', () => {
    const { h, vals, nodes } = setup([
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
      { id: 3, v: 'c' },
    ])
    const before = nodes()
    // same length, same keys, two values change -> fast path
    h.send({
      type: 'set',
      rows: [
        { id: 1, v: 'A' },
        { id: 2, v: 'b' },
        { id: 3, v: 'C' },
      ],
    })
    expect(vals()).toEqual(['A', 'b', 'C'])
    expect(nodes()).toEqual(before) // every node reused, none recreated
  })

  it('streams many in-place updates correctly (the tick pattern)', () => {
    const { h, vals } = setup(Array.from({ length: 50 }, (_, i) => ({ id: i, v: `0` })))
    for (let t = 1; t <= 20; t++) {
      // each "tick" replaces a few rows' values with new objects (same ids/order)
      const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, v: String(i % t) }))
      h.send({ type: 'set', rows })
      expect(vals()).toEqual(rows.map((r) => r.v))
    }
  })

  it('bails to the full reconcile when keys reorder, then resumes fast updates', () => {
    const { h, vals, nodes } = setup([
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
      { id: 3, v: 'c' },
    ])
    const [n1, n2, n3] = nodes()
    // reorder (keys move) -> bail to full reconcile, nodes reused & moved
    h.send({
      type: 'set',
      rows: [
        { id: 3, v: 'c' },
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
      ],
    })
    expect(vals()).toEqual(['c', 'a', 'b'])
    expect(nodes()).toEqual([n3, n1, n2])
    // now a same-structure value update again -> fast path on the new order
    h.send({
      type: 'set',
      rows: [
        { id: 3, v: 'C' },
        { id: 1, v: 'a' },
        { id: 2, v: 'B' },
      ],
    })
    expect(vals()).toEqual(['C', 'a', 'B'])
    expect(nodes()).toEqual([n3, n1, n2])
  })

  it('bails when a row is replaced at a position (key changes, same length)', () => {
    const { h, vals } = setup([
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
    ])
    // same length, but id 2 -> id 9 (key changed) -> full reconcile (create/remove)
    h.send({
      type: 'set',
      rows: [
        { id: 1, v: 'a' },
        { id: 9, v: 'z' },
      ],
    })
    expect(vals()).toEqual(['a', 'z'])
  })

  it('handles add/remove (length change) via the full reconcile', () => {
    const { h, vals } = setup([{ id: 1, v: 'a' }])
    h.send({
      type: 'set',
      rows: [
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
      ],
    })
    expect(vals()).toEqual(['a', 'b'])
    h.send({ type: 'set', rows: [{ id: 2, v: 'b' }] })
    expect(vals()).toEqual(['b'])
  })
})
