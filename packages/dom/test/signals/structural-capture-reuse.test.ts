import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalShow, signalEach, type RowCtx } from '../../src/signals/dom'

// Regression for the dicerun report "show() reinserts disposed structural nodes".
// A structural primitive built ONCE and captured, then reused inside a `show` arm that
// toggles, used to render nothing on the second mount (the captured fragment was drained
// and its scope disposed). Now that structural primitives are lazy `Mountable`s that
// materialize at placement time, capture-and-reuse is correct by construction: each
// remount materializes a fresh instance into the current arm scope.

interface Row {
  id: number
  label: string
}
interface S {
  on: boolean
  rows: Row[]
}
type M = { type: 'toggle' } | { type: 'setRows'; rows: Row[] }

const labels = (root: Element): string[] =>
  [...root.querySelectorAll('li')].map((li) => li.textContent ?? '')

function captured(initial: S) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => initial,
    update: (s, m) => (m.type === 'toggle' ? { ...s, on: !s.on } : { ...s, rows: m.rows }),
    view: () => {
      // Built ONCE, captured, reused on every remount of the show arm.
      const slot = [
        signalEach<Row>(
          { items: (s) => (s as S).rows, deps: ['rows'] },
          (r) => r.id,
          () => [
            el('li', {}, [
              signalText((ctx) => ((ctx as RowCtx<Row>).item as Row).label, ['item.label']),
            ]),
          ],
        ),
      ]
      return [
        el('div', {}, [
          signalShow({ produce: (s) => (s as S).on, deps: ['on'] }, () => [
            el('div', { class: 'card' }, [el('div', { class: 'contents' }, slot)]),
          ]),
        ]),
      ]
    },
  })
  return { h, root: container.querySelector('div')! }
}

describe('captured structural primitive reused across remount', () => {
  it('renders on first mount', () => {
    const { root } = captured({
      on: true,
      rows: [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
    })
    expect(labels(root)).toEqual(['a', 'b'])
  })

  it('re-renders correctly after hide -> show (the report bug)', () => {
    const { h, root } = captured({
      on: true,
      rows: [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
    })
    expect(labels(root)).toEqual(['a', 'b'])

    h.send({ type: 'toggle' }) // hide — disposes the arm + the captured each's scope
    expect(labels(root)).toEqual([])

    h.send({ type: 'toggle' }) // show again — must rebuild fresh, not insert dead nodes
    expect(labels(root)).toEqual(['a', 'b'])
  })

  it('reflects rows changed while hidden, after re-show', () => {
    const { h, root } = captured({ on: true, rows: [{ id: 1, label: 'a' }] })
    h.send({ type: 'toggle' }) // hide
    h.send({ type: 'setRows', rows: [{ id: 9, label: 'z' }] }) // change while hidden
    h.send({ type: 'toggle' }) // show
    expect(labels(root)).toEqual(['z'])
  })

  it('survives multiple hide/show cycles', () => {
    const { h, root } = captured({ on: true, rows: [{ id: 1, label: 'a' }] })
    for (let i = 0; i < 3; i++) {
      h.send({ type: 'toggle' }) // hide
      h.send({ type: 'toggle' }) // show
    }
    expect(labels(root)).toEqual(['a'])
  })
})

describe('same Mountable placed twice → two independent live instances', () => {
  it('renders both placements and keeps both reactive', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ on: true, rows: [{ id: 1, label: 'a' }] }),
      update: (s, m) => (m.type === 'toggle' ? { ...s, on: !s.on } : { ...s, rows: m.rows }),
      view: () => {
        const slot = [
          signalEach<Row>(
            { items: (s) => (s as S).rows, deps: ['rows'] },
            (r) => r.id,
            () => [
              el('li', {}, [
                signalText((ctx) => ((ctx as RowCtx<Row>).item as Row).label, ['item.label']),
              ]),
            ],
          ),
        ]
        // Placed into TWO elements in one build — each placement is its own live each.
        return [el('div', {}, [el('ul', { id: 'one' }, slot), el('ul', { id: 'two' }, slot)])]
      },
    })
    const root = container.querySelector('div')!
    expect(labels(root.querySelector('#one')!)).toEqual(['a'])
    expect(labels(root.querySelector('#two')!)).toEqual(['a'])

    h.send({
      type: 'setRows',
      rows: [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
    })
    expect(labels(root.querySelector('#one')!)).toEqual(['a', 'b'])
    expect(labels(root.querySelector('#two')!)).toEqual(['a', 'b'])
  })
})
