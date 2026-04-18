import { describe, it, expect, afterEach } from 'vitest'
import { createComponentInstance, flushInstance } from '../src/update-loop'
import { createBinding, setFlatBindings } from '../src/binding'
import { createLifetime, disposeLifetime } from '../src/lifetime'
import type { ComponentDef } from '../src/types'

type State = { name: string; age: number }
type Msg = { type: 'setName'; value: string } | { type: 'setAge'; value: number }

function twoPropDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'TwoProp',
    init: () => [{ name: 'Alice', age: 30 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setName':
          return [{ ...state, name: msg.value }, []]
        case 'setAge':
          return [{ ...state, age: msg.value }, []]
      }
    },
    view: () => [],
    __dirty: (o, n) =>
      (Object.is(o.name, n.name) ? 0 : 0b01) | (Object.is(o.age, n.age) ? 0 : 0b10),
  }
}

function wireFlat<S, M, E>(inst: import('../src/update-loop').ComponentInstance<S, M, E>) {
  setFlatBindings(inst.allBindings)
}

describe('Phase 2 — binding iteration', () => {
  afterEach(() => {
    setFlatBindings(null)
  })

  it('updates text bindings whose mask matches the dirty mask', () => {
    const inst = createComponentInstance(twoPropDef())
    wireFlat(inst)
    const nameNode = document.createTextNode('')
    const ageNode = document.createTextNode('')

    createBinding(inst.rootLifetime, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node: nameNode,
      perItem: false,
    })
    createBinding(inst.rootLifetime, {
      mask: 0b10,
      accessor: (s: State) => String(s.age),
      kind: 'text',
      node: ageNode,
      perItem: false,
    })

    nameNode.nodeValue = 'Alice'
    ageNode.nodeValue = '30'

    inst.send({ type: 'setName', value: 'Bob' })
    flushInstance(inst)

    expect(nameNode.nodeValue).toBe('Bob')
    expect(ageNode.nodeValue).toBe('30')
  })

  it('skips binding when accessor returns same value (Object.is)', () => {
    const inst = createComponentInstance(twoPropDef())
    wireFlat(inst)
    const nameNode = document.createTextNode('Alice')

    const binding = createBinding(inst.rootLifetime, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node: nameNode,
      perItem: false,
    })
    binding.lastValue = 'Alice'

    inst.send({ type: 'setName', value: 'Alice' })
    flushInstance(inst)

    expect(nameNode.nodeValue).toBe('Alice')
  })

  it('updates attr bindings correctly', () => {
    const inst = createComponentInstance(twoPropDef())
    wireFlat(inst)
    const el = document.createElement('div')

    createBinding(inst.rootLifetime, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'attr',
      node: el,
      key: 'data-name',
      perItem: false,
    })

    inst.send({ type: 'setName', value: 'Charlie' })
    flushInstance(inst)

    expect(el.getAttribute('data-name')).toBe('Charlie')
  })

  it('handles multiple bindings on different masks in one update cycle', () => {
    const inst = createComponentInstance(twoPropDef())
    wireFlat(inst)
    const nameNode = document.createTextNode('')
    const ageNode = document.createTextNode('')

    createBinding(inst.rootLifetime, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node: nameNode,
      perItem: false,
    })
    createBinding(inst.rootLifetime, {
      mask: 0b10,
      accessor: (s: State) => String(s.age),
      kind: 'text',
      node: ageNode,
      perItem: false,
    })

    inst.send({ type: 'setName', value: 'Dana' })
    inst.send({ type: 'setAge', value: 25 })
    flushInstance(inst)

    expect(nameNode.nodeValue).toBe('Dana')
    expect(ageNode.nodeValue).toBe('25')
  })

  it('skips bindings on disposed child scopes', () => {
    const inst = createComponentInstance(twoPropDef())
    wireFlat(inst)
    const childLifetime = createLifetime(inst.rootLifetime)
    const node = document.createTextNode('')

    createBinding(childLifetime, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node,
      perItem: false,
    })

    disposeLifetime(childLifetime)

    inst.send({ type: 'setName', value: 'Ghost' })
    flushInstance(inst)

    expect(node.nodeValue).toBe('')
  })
})
