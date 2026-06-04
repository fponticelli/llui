import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalEach, type RowCtx } from '../../src/signals/dom'

// State-fanout gating (B): a row that reads component state re-evaluates EVERY
// row only when a state path it reads actually changed. A reconcile triggered by
// an items change that leaves the row's state paths untouched updates just the
// changed rows — but a change to a read state path must still fan out to all.
// This guards against the gating skipping a needed update (stale render).

interface Row {
  id: number
  v: string
}
interface S {
  rows: Row[]
  mode: string
  counter: number
}
type M = { type: 'rows'; rows: Row[] } | { type: 'mode'; mode: string }

function mount(initial: S) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => initial,
    update: (s, m) =>
      m.type === 'rows' ? { ...s, rows: m.rows, counter: s.counter + 1 } : { ...s, mode: m.mode },
    view: () => [
      el('ul', {}, [
        // each fires on rows OR mode (the source.deps merge the compiler does);
        // each row reads BOTH its item AND the component `mode`.
        signalEach<Row>(
          { items: (s) => (s as S).rows, deps: ['rows', 'mode'] },
          (r) => r.id,
          () => [
            el('li', {}, [
              signalText(
                (ctx) => {
                  const c = ctx as RowCtx<Row>
                  return `${(c.state as S).mode}:${c.item.v}`
                },
                ['state.mode', 'item.v'],
              ),
            ]),
          ],
        ),
      ]),
    ],
  })
  const ul = container.querySelector('ul')!
  const cells = (): string[] => [...ul.querySelectorAll('li')].map((li) => li.textContent ?? '')
  return { h, cells }
}

describe('signalEach — state-fanout gating (B)', () => {
  it('an items-only change updates only changed rows; a state change fans out to all', () => {
    const { h, cells } = mount({
      rows: [
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
        { id: 3, v: 'c' },
      ],
      mode: 'X',
      counter: 0,
    })
    expect(cells()).toEqual(['X:a', 'X:b', 'X:c'])

    // items change, mode unchanged -> only row 2 updates; others stay correct
    h.send({
      type: 'rows',
      rows: [
        { id: 1, v: 'a' },
        { id: 2, v: 'B' },
        { id: 3, v: 'c' },
      ],
    })
    expect(cells()).toEqual(['X:a', 'X:B', 'X:c'])

    // mode change -> MUST fan out to every row (the gating must not skip this)
    h.send({ type: 'mode', mode: 'Y' })
    expect(cells()).toEqual(['Y:a', 'Y:B', 'Y:c'])

    // another items-only change after a mode change -> gating resumes correctly
    h.send({
      type: 'rows',
      rows: [
        { id: 1, v: 'A' },
        { id: 2, v: 'B' },
        { id: 3, v: 'c' },
      ],
    })
    expect(cells()).toEqual(['Y:A', 'Y:B', 'Y:c'])

    // mode change again -> fans out, picking up the latest item values
    h.send({ type: 'mode', mode: 'Z' })
    expect(cells()).toEqual(['Z:A', 'Z:B', 'Z:c'])
  })
})
