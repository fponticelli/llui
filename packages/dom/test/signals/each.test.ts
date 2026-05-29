import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, react, signalEach, type RowCtx } from '../../src/signals/dom'

interface Todo {
  id: number
  title: string
  done: boolean
}
interface S {
  todos: Todo[]
}
type M = { type: 'set'; todos: Todo[] }

function setup(initial: Todo[]) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ todos: initial }),
    update: (_s, m) => ({ todos: m.todos }),
    view: () => [
      el('ul', {}, [
        signalEach<Todo>(
          { items: (s) => (s as S).todos, deps: ['todos'] },
          (t) => t.id,
          // row scope's state is the combined ctx { item, state }; bindings read ctx.item.*
          () => [
            el('li', {}, [
              signalText((ctx) => ((ctx as RowCtx<Todo>).item as Todo).title, ['item.title']),
            ]),
          ],
        ),
      ]),
    ],
  })
  const ul = container.querySelector('ul')!
  const titles = (): string[] => [...ul.querySelectorAll('li')].map((li) => li.textContent ?? '')
  return { h, ul, titles }
}

describe('signalEach — keyed list reconciliation', () => {
  it('renders initial rows', () => {
    const { titles } = setup([
      { id: 1, title: 'a', done: false },
      { id: 2, title: 'b', done: false },
    ])
    expect(titles()).toEqual(['a', 'b'])
  })

  it('appends a new row, keeping existing row nodes in place', () => {
    const { h, ul, titles } = setup([{ id: 1, title: 'a', done: false }])
    const liA = ul.querySelector('li')!
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a', done: false },
        { id: 2, title: 'b', done: false },
      ],
    })
    expect(titles()).toEqual(['a', 'b'])
    expect(ul.querySelector('li')).toBe(liA) // existing row not recreated
  })

  it('removes a row', () => {
    const { h, titles } = setup([
      { id: 1, title: 'a', done: false },
      { id: 2, title: 'b', done: false },
    ])
    h.send({ type: 'set', todos: [{ id: 2, title: 'b', done: false }] })
    expect(titles()).toEqual(['b'])
  })

  it('reorders rows by key (same nodes moved, not recreated)', () => {
    const { h, ul, titles } = setup([
      { id: 1, title: 'a', done: false },
      { id: 2, title: 'b', done: false },
    ])
    const lis = [...ul.querySelectorAll('li')]
    const liA = lis[0]!
    const liB = lis[1]!
    h.send({
      type: 'set',
      todos: [
        { id: 2, title: 'b', done: false },
        { id: 1, title: 'a', done: false },
      ],
    })
    expect(titles()).toEqual(['b', 'a'])
    const reordered = [...ul.querySelectorAll('li')]
    expect(reordered[0]).toBe(liB) // same nodes, reordered
    expect(reordered[1]).toBe(liA)
  })

  it('updates a single row in place when its item changes', () => {
    const { h, ul, titles } = setup([
      { id: 1, title: 'a', done: false },
      { id: 2, title: 'b', done: false },
    ])
    const lis = [...ul.querySelectorAll('li')]
    const liA = lis[0]!
    const liB = lis[1]!
    const textA = liA.firstChild as Text
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'A!', done: false }, // changed
        { id: 2, title: 'b', done: false }, // same
      ],
    })
    expect(titles()).toEqual(['A!', 'b'])
    expect(ul.querySelectorAll('li')[0]).toBe(liA) // same row node
    expect(textA.data).toBe('A!') // same text node, mutated in place
    expect(ul.querySelectorAll('li')[1]).toBe(liB) // unchanged row untouched
  })

  it('handles a full replace + grow', () => {
    const { h, titles } = setup([{ id: 1, title: 'a', done: false }])
    h.send({
      type: 'set',
      todos: [
        { id: 3, title: 'x', done: false },
        { id: 4, title: 'y', done: false },
        { id: 5, title: 'z', done: false },
      ],
    })
    expect(titles()).toEqual(['x', 'y', 'z'])
  })
})

describe('signalEach — multi-root rows (item + component state)', () => {
  interface MS {
    rows: { id: number; name: string }[]
    mode: 'a' | 'b'
  }
  type MM = { type: 'setRows'; rows: MS['rows'] } | { type: 'toggle' }

  function msetup(initial: MS) {
    const container = document.createElement('div')
    const h = mountSignalComponent<MS, MM>(container, {
      init: () => initial,
      update: (s, m) =>
        m.type === 'toggle' ? { ...s, mode: s.mode === 'a' ? 'b' : 'a' } : { ...s, rows: m.rows },
      view: () => [
        el('ul', {}, [
          // deps include both the items path AND the component-state path rows read
          signalEach<MS['rows'][number]>(
            { items: (s) => (s as MS).rows, deps: ['rows', 'mode'] },
            (r) => r.id,
            () => [
              el(
                'li',
                {
                  class: react(
                    (ctx) =>
                      `mode-${(ctx as RowCtx<MS['rows'][number]>).state ? (ctx as { state: MS }).state.mode : ''}`,
                    ['state.mode'],
                  ),
                },
                [signalText((ctx) => (ctx as RowCtx<MS['rows'][number]>).item.name, ['item.name'])],
              ),
            ],
          ),
        ]),
      ],
    })
    const ul = container.querySelector('ul')!
    return { h, ul }
  }

  it('a component-state change fans out to every row; an item change hits one', () => {
    const { h, ul } = msetup({
      rows: [
        { id: 1, name: 'x' },
        { id: 2, name: 'y' },
      ],
      mode: 'a',
    })
    const lis = () => [...ul.querySelectorAll('li')]
    expect(lis().map((li) => li.getAttribute('class'))).toEqual(['mode-a', 'mode-a'])
    expect(lis().map((li) => li.textContent)).toEqual(['x', 'y'])

    const [li1, li2] = lis()
    // toggle mode -> fan-out to BOTH rows' class, names untouched, same nodes
    h.send({ type: 'toggle' })
    expect(lis().map((li) => li.getAttribute('class'))).toEqual(['mode-b', 'mode-b'])
    expect(lis()[0]).toBe(li1)
    expect(lis()[1]).toBe(li2)
    expect(lis().map((li) => li.textContent)).toEqual(['x', 'y'])

    // change one row's name -> only that row's text updates
    h.send({
      type: 'setRows',
      rows: [
        { id: 1, name: 'X!' },
        { id: 2, name: 'y' },
      ],
    })
    expect(lis().map((li) => li.textContent)).toEqual(['X!', 'y'])
    expect(lis().map((li) => li.getAttribute('class'))).toEqual(['mode-b', 'mode-b'])
  })
})
