import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  el,
  signalEachDirect,
  type RowCtx,
  type DirectRow,
  type SignalDoc,
} from '../../src/signals/dom'

// Direct-construction keyed list (`signalEachDirect`): the compiled fast path that
// builds rows with direct DOM ops + binding specs wired by node reference, sharing
// the keyed reconcile with `signalEach`. These assert it renders, updates values,
// reorders by key (reusing nodes), removes, and appends — same contract as `each`.

interface Item {
  id: number
  label: string
}
interface S {
  rows: Item[]
}
type M = { type: 'set'; rows: Item[] }

/** What the compiler would emit for `render: (item) => [li([text(item.at('label'))])]`. */
function rowFactory(doc: SignalDoc): DirectRow {
  const li = doc.createElement('li')
  const t = doc.createTextNode('')
  li.appendChild(t)
  return {
    nodes: [li],
    bindings: [
      {
        deps: ['item.label'],
        produce: (ctx) => (ctx as RowCtx<Item>).item.label,
        commit: (v) => {
          t.data = v == null ? '' : String(v)
        },
      },
    ],
  }
}

function setup(initial: Item[]) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ rows: initial }),
    update: (_s, m) => ({ rows: m.rows }),
    view: () => [
      el('ul', {}, [
        signalEachDirect<Item>(
          { items: (s) => (s as S).rows, deps: ['rows'] },
          (it) => it.id,
          rowFactory,
        ),
      ]),
    ],
  })
  const ul = container.querySelector('ul')!
  const labels = (): string[] => [...ul.querySelectorAll('li')].map((li) => li.textContent ?? '')
  return { h, ul, labels }
}

describe('signalEachDirect — direct-construction keyed list', () => {
  it('renders initial rows', () => {
    const { labels } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    expect(labels()).toEqual(['a', 'b'])
  })

  it('updates a row value in place without recreating the node', () => {
    const { h, ul, labels } = setup([{ id: 1, label: 'a' }])
    const li1 = ul.querySelector('li')!
    h.send({ type: 'set', rows: [{ id: 1, label: 'A!' }] })
    expect(labels()).toEqual(['A!'])
    expect(ul.querySelector('li')).toBe(li1) // same node, mutated in place
  })

  it('appends keeping existing nodes', () => {
    const { h, ul, labels } = setup([{ id: 1, label: 'a' }])
    const li1 = ul.querySelector('li')!
    h.send({
      type: 'set',
      rows: [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
    })
    expect(labels()).toEqual(['a', 'b'])
    expect(ul.querySelector('li')).toBe(li1)
  })

  it('reorders by key, reusing the same row nodes', () => {
    const { h, ul, labels } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ])
    const [n1, n2, n3] = [...ul.querySelectorAll('li')]
    h.send({
      type: 'set',
      rows: [
        { id: 3, label: 'c' },
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
    })
    expect(labels()).toEqual(['c', 'a', 'b'])
    const reordered = [...ul.querySelectorAll('li')]
    expect(reordered[0]).toBe(n3)
    expect(reordered[1]).toBe(n1)
    expect(reordered[2]).toBe(n2)
  })

  it('removes a row', () => {
    const { h, labels } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ])
    h.send({
      type: 'set',
      rows: [
        { id: 1, label: 'a' },
        { id: 3, label: 'c' },
      ],
    })
    expect(labels()).toEqual(['a', 'c'])
  })

  it('clears all rows', () => {
    const { h, labels } = setup([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    h.send({ type: 'set', rows: [] })
    expect(labels()).toEqual([])
  })
})
