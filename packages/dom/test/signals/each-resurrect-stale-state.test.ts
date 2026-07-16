import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalEach, type RowCtx } from '../../src/signals/dom'
import type { TransitionOptions } from '../../src/types'

// Regression (audit finding: keyed-each resurrection misses interim state changes):
// a row removed then re-added while its `leave` animation is in flight resurrects
// with its OLD ctx. When its item ref + index are unchanged, the identity gate would
// skip the update — but on a GATABLE list the row reads a component-state path that
// changed while it was out of the reconcile set (the RowStateGate snapshot advanced
// without it), so it would render stale. Resurrection must force a re-evaluation.

interface Row {
  id: number
  v: string
}
interface S {
  rows: Row[]
  suffix: string
}
type M = { type: 'rows'; rows: Row[] } | { type: 'suffix'; v: string }

function makeLeave() {
  const resolvers: Array<() => void> = []
  return {
    leave: (): Promise<void> => new Promise<void>((r) => resolvers.push(r)),
    resolveAll: () => resolvers.splice(0).forEach((r) => r()),
  }
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('signalEach resurrection — stale gatable component-state', () => {
  it('a row resurrected mid-leave reflects a state-path change made while it was leaving', async () => {
    const { leave, resolveAll } = makeLeave()
    const transition: TransitionOptions = { leave }
    const rowA: Row = { id: 1, v: 'a' }
    const rowB: Row = { id: 2, v: 'b' }
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ rows: [rowA, rowB], suffix: 'x' }),
      update: (s, m) => (m.type === 'rows' ? { ...s, rows: m.rows } : { ...s, suffix: m.v }),
      view: () => [
        el('ul', {}, [
          signalEach<Row>(
            { items: (s) => (s as S).rows, deps: ['rows', 'suffix'] },
            (r) => r.id,
            () => [
              el('li', {}, [
                signalText(
                  (ctx) => {
                    const c = ctx as RowCtx<Row>
                    return `${c.item.v}-${(c.state as S).suffix}`
                  },
                  ['item.v', 'state.suffix'], // gatable component-state path
                ),
              ]),
            ],
            undefined,
            transition,
          ),
        ]),
      ],
    })
    const ul = container.querySelector('ul')!
    const cells = () => [...ul.querySelectorAll('li')].map((li) => li.textContent)
    expect(cells()).toEqual(['a-x', 'b-x'])

    // Remove rowB → it starts leaving (deferred detach; still in the DOM).
    h.send({ type: 'rows', rows: [rowA] })
    expect(cells()).toEqual(['a-x', 'b-x'])

    // Change the gatable state path WHILE rowB is leaving (out of the reconcile set).
    h.send({ type: 'suffix', v: 'y' })
    expect(cells()[0]).toBe('a-y')

    // Re-add rowB (same object ref → item + index unchanged) → resurrects.
    h.send({ type: 'rows', rows: [rowA, rowB] })
    // Without the fix, rowB keeps the stale 'b-x'; with it, it re-evaluates to 'b-y'.
    expect(cells()).toEqual(['a-y', 'b-y'])

    resolveAll()
    await flush()
    h.dispose()
  })
})
