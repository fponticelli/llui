import { describe, it, expect } from 'vitest'
import { createComponentInstance, flushInstance } from '../src/update-loop'
import { createBinding } from '../src/binding'
import { createScope, disposeScope } from '../src/scope'
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
    // name = bit 0, age = bit 1
    __dirty: (o, n) =>
      (Object.is(o.name, n.name) ? 0 : 0b01) | (Object.is(o.age, n.age) ? 0 : 0b10),
  }
}

describe('Phase 2 — binding iteration', () => {
  it('updates text bindings whose mask matches the dirty mask', () => {
    const inst = createComponentInstance(twoPropDef())
    const nameNode = document.createTextNode('')
    const ageNode = document.createTextNode('')

    createBinding(inst.rootScope, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node: nameNode,
      perItem: false,
    })
    createBinding(inst.rootScope, {
      mask: 0b10,
      accessor: (s: State) => String(s.age),
      kind: 'text',
      node: ageNode,
      perItem: false,
    })

    // Initial evaluation
    nameNode.nodeValue = 'Alice'
    ageNode.nodeValue = '30'

    // Change only name
    inst.send({ type: 'setName', value: 'Bob' })
    flushInstance(inst)

    expect(nameNode.nodeValue).toBe('Bob')
    expect(ageNode.nodeValue).toBe('30') // unchanged — mask didn't match
  })

  it('skips binding when accessor returns same value (Object.is)', () => {
    const inst = createComponentInstance(twoPropDef())
    const nameNode = document.createTextNode('Alice')

    const binding = createBinding(inst.rootScope, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node: nameNode,
      perItem: false,
    })
    // Pre-set lastValue so the Object.is check kicks in
    binding.lastValue = 'Alice'

    // Send a message that changes name to same value
    inst.send({ type: 'setName', value: 'Alice' })
    flushInstance(inst)

    // Mask matches (dirty bit 0 set), but Object.is('Alice', 'Alice') → skip
    expect(nameNode.nodeValue).toBe('Alice')
  })

  it('updates attr bindings correctly', () => {
    const inst = createComponentInstance(twoPropDef())
    const el = document.createElement('div')

    createBinding(inst.rootScope, {
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
    const nameNode = document.createTextNode('')
    const ageNode = document.createTextNode('')

    createBinding(inst.rootScope, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node: nameNode,
      perItem: false,
    })
    createBinding(inst.rootScope, {
      mask: 0b10,
      accessor: (s: State) => String(s.age),
      kind: 'text',
      node: ageNode,
      perItem: false,
    })

    // Change both in one batch
    inst.send({ type: 'setName', value: 'Dana' })
    inst.send({ type: 'setAge', value: 25 })
    flushInstance(inst)

    expect(nameNode.nodeValue).toBe('Dana')
    expect(ageNode.nodeValue).toBe('25')
  })

  it('skips bindings on disposed child scopes', () => {
    const inst = createComponentInstance(twoPropDef())
    const childScope = createScope(inst.rootScope)
    const node = document.createTextNode('')

    createBinding(childScope, {
      mask: 0b01,
      accessor: (s: State) => s.name,
      kind: 'text',
      node,
      perItem: false,
    })

    // Dispose the child scope — its bindings should be removed
    disposeScope(childScope)

    inst.send({ type: 'setName', value: 'Ghost' })
    flushInstance(inst)

    // The binding was removed during scope disposal, so node is untouched
    expect(node.nodeValue).toBe('')
  })
})
