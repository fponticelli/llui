import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalEach } from '../../src/signals/dom'

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
          { produce: (s) => (s as S).todos, deps: ['todos'] },
          (t) => t.id,
          // row scope's state is the item; produce fns read the item
          () => [el('li', {}, [signalText((it) => (it as Todo).title, ['title'])])],
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
