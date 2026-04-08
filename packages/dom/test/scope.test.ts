import { describe, it, expect } from 'vitest'
import { createScope, disposeScope, addDisposer, addBinding } from '../src/scope'
import type { Binding } from '../src/types'

describe('createScope', () => {
  it('creates a root scope with no parent', () => {
    const scope = createScope(null)
    expect(scope.parent).toBeNull()
    expect(scope.children).toEqual([])
    expect(scope.disposers).toEqual([])
    expect(scope.bindings).toEqual([])
  })

  it('creates a child scope linked to its parent', () => {
    const parent = createScope(null)
    const child = createScope(parent)
    expect(child.parent).toBe(parent)
    expect(parent.children).toContain(child)
  })

  it('assigns unique ids', () => {
    const a = createScope(null)
    const b = createScope(null)
    expect(a.id).not.toBe(b.id)
  })
})

describe('disposeScope', () => {
  it('fires all disposers', () => {
    const scope = createScope(null)
    const calls: string[] = []
    addDisposer(scope, () => calls.push('a'))
    addDisposer(scope, () => calls.push('b'))
    disposeScope(scope)
    expect(calls).toEqual(['a', 'b'])
  })

  it('disposes children depth-first', () => {
    const order: number[] = []
    const parent = createScope(null)
    const child1 = createScope(parent)
    const grandchild = createScope(child1)
    const child2 = createScope(parent)

    addDisposer(grandchild, () => order.push(grandchild.id))
    addDisposer(child1, () => order.push(child1.id))
    addDisposer(child2, () => order.push(child2.id))
    addDisposer(parent, () => order.push(parent.id))

    disposeScope(parent)

    // depth-first: grandchild before child1, child1 before child2, child2 before parent
    expect(order).toEqual([grandchild.id, child1.id, child2.id, parent.id])
  })

  it('removes itself from parent children list', () => {
    const parent = createScope(null)
    const child = createScope(parent)
    expect(parent.children).toContain(child)
    disposeScope(child)
    expect(parent.children).not.toContain(child)
  })

  it('clears bindings on disposed scope', () => {
    const scope = createScope(null)
    const binding: Binding = {
      mask: 1,
      accessor: () => 'x',
      lastValue: 'x',
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
      dead: false,
      ownerScope: scope,
    }
    addBinding(scope, binding)
    expect(scope.bindings.length).toBe(1)
    disposeScope(scope)
    expect(binding.dead).toBe(true)
  })

  it('is idempotent — disposing twice does not throw or double-fire', () => {
    const scope = createScope(null)
    let count = 0
    addDisposer(scope, () => count++)
    disposeScope(scope)
    disposeScope(scope) // second dispose — scope may be pooled, but should not throw
    expect(count).toBe(1)
  })
})
