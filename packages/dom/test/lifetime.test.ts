import { describe, it, expect } from 'vitest'
import { createLifetime, disposeLifetime, addDisposer, addBinding } from '../src/lifetime'
import type { Binding } from '../src/types'

describe('createLifetime', () => {
  it('creates a root scope with no parent', () => {
    const scope = createLifetime(null)
    expect(scope.parent).toBeNull()
    expect(scope.children).toEqual([])
    expect(scope.disposers).toEqual([])
    expect(scope.bindings).toEqual([])
  })

  it('creates a child scope linked to its parent', () => {
    const parent = createLifetime(null)
    const child = createLifetime(parent)
    expect(child.parent).toBe(parent)
    expect(parent.children).toContain(child)
  })

  it('assigns unique ids', () => {
    const a = createLifetime(null)
    const b = createLifetime(null)
    expect(a.id).not.toBe(b.id)
  })
})

describe('disposeLifetime', () => {
  it('fires all disposers', () => {
    const scope = createLifetime(null)
    const calls: string[] = []
    addDisposer(scope, () => calls.push('a'))
    addDisposer(scope, () => calls.push('b'))
    disposeLifetime(scope)
    expect(calls).toEqual(['a', 'b'])
  })

  it('disposes children depth-first', () => {
    const order: number[] = []
    const parent = createLifetime(null)
    const child1 = createLifetime(parent)
    const grandchild = createLifetime(child1)
    const child2 = createLifetime(parent)

    addDisposer(grandchild, () => order.push(grandchild.id))
    addDisposer(child1, () => order.push(child1.id))
    addDisposer(child2, () => order.push(child2.id))
    addDisposer(parent, () => order.push(parent.id))

    disposeLifetime(parent)

    // depth-first: grandchild before child1, child1 before child2, child2 before parent
    expect(order).toEqual([grandchild.id, child1.id, child2.id, parent.id])
  })

  it('removes itself from parent children list', () => {
    const parent = createLifetime(null)
    const child = createLifetime(parent)
    expect(parent.children).toContain(child)
    disposeLifetime(child)
    expect(parent.children).not.toContain(child)
  })

  it('clears bindings on disposed scope', () => {
    const scope = createLifetime(null)
    const binding: Binding = {
      mask: 1,
      accessor: () => 'x',
      lastValue: 'x',
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
      dead: false,
      ownerLifetime: scope,
    }
    addBinding(scope, binding)
    expect(scope.bindings.length).toBe(1)
    disposeLifetime(scope)
    expect(binding.dead).toBe(true)
  })

  it('is idempotent — disposing twice does not throw or double-fire', () => {
    const scope = createLifetime(null)
    let count = 0
    addDisposer(scope, () => count++)
    disposeLifetime(scope)
    disposeLifetime(scope) // second dispose — scope may be pooled, but should not throw
    expect(count).toBe(1)
  })
})
