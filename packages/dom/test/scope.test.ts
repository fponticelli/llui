import { describe, it, expect } from 'vitest'
import { createScope, disposeScope } from '../src/scope'

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
    scope.disposers.push(() => calls.push('a'))
    scope.disposers.push(() => calls.push('b'))
    disposeScope(scope)
    expect(calls).toEqual(['a', 'b'])
  })

  it('disposes children depth-first', () => {
    const order: number[] = []
    const parent = createScope(null)
    const child1 = createScope(parent)
    const grandchild = createScope(child1)
    const child2 = createScope(parent)

    grandchild.disposers.push(() => order.push(grandchild.id))
    child1.disposers.push(() => order.push(child1.id))
    child2.disposers.push(() => order.push(child2.id))
    parent.disposers.push(() => order.push(parent.id))

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
    scope.bindings.push({} as never)
    disposeScope(scope)
    expect(scope.bindings).toEqual([])
  })

  it('is idempotent — disposing twice does not throw or double-fire', () => {
    const scope = createScope(null)
    let count = 0
    scope.disposers.push(() => count++)
    disposeScope(scope)
    disposeScope(scope)
    expect(count).toBe(1)
  })
})
