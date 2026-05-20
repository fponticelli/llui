import { describe, it, expect } from 'vitest'
import {
  createBindingRegistry,
  registerBinding,
  unregisterBinding,
  dispatchChanged,
} from '../src/binding-registry'
import type { Binding } from '../src/types'

// A binding is identified by reference. Phase 1 tests don't care about the
// binding's fields — only register/unregister/dispatch identity behavior.
function makeBinding(label: string): Binding {
  return { __label: label } as unknown as Binding
}

describe('binding-registry — Option B Phase 1', () => {
  it('fires a binding registered under one prefix when that prefix changes', () => {
    const reg = createBindingRegistry()
    const b = makeBinding('a')
    registerBinding(reg, b, [3])

    const fired: Binding[] = []
    dispatchChanged(reg, [3], (binding) => fired.push(binding))

    expect(fired).toEqual([b])
  })

  it('does not fire a binding when none of its prefixes changed', () => {
    const reg = createBindingRegistry()
    registerBinding(reg, makeBinding('a'), [3])

    const fired: Binding[] = []
    dispatchChanged(reg, [4, 5], (binding) => fired.push(binding))

    expect(fired).toEqual([])
  })

  it('fires a binding registered under multiple prefixes exactly once when several change', () => {
    const reg = createBindingRegistry()
    const b = makeBinding('a')
    registerBinding(reg, b, [3, 7])

    const fired: Binding[] = []
    dispatchChanged(reg, [3, 7], (binding) => fired.push(binding))

    expect(fired).toEqual([b])
  })

  it('fires two bindings registered under the same prefix', () => {
    const reg = createBindingRegistry()
    const b1 = makeBinding('a')
    const b2 = makeBinding('b')
    registerBinding(reg, b1, [3])
    registerBinding(reg, b2, [3])

    const fired = new Set<Binding>()
    dispatchChanged(reg, [3], (binding) => fired.add(binding))

    expect(fired).toEqual(new Set([b1, b2]))
  })

  it('unregister removes the binding from all prefix sets', () => {
    const reg = createBindingRegistry()
    const b = makeBinding('a')
    registerBinding(reg, b, [3, 7, 11])
    unregisterBinding(reg, b)

    const fired: Binding[] = []
    dispatchChanged(reg, [3, 7, 11], (binding) => fired.push(binding))

    expect(fired).toEqual([])
  })

  it('unregister of one binding does not affect siblings under the same prefix', () => {
    const reg = createBindingRegistry()
    const b1 = makeBinding('a')
    const b2 = makeBinding('b')
    registerBinding(reg, b1, [3])
    registerBinding(reg, b2, [3])
    unregisterBinding(reg, b1)

    const fired: Binding[] = []
    dispatchChanged(reg, [3], (binding) => fired.push(binding))

    expect(fired).toEqual([b2])
  })

  it('dispatch with an empty changed list is a no-op', () => {
    const reg = createBindingRegistry()
    registerBinding(reg, makeBinding('a'), [3])

    const fired: Binding[] = []
    dispatchChanged(reg, [], (binding) => fired.push(binding))

    expect(fired).toEqual([])
  })

  it('dispatch against an empty registry is a no-op', () => {
    const reg = createBindingRegistry()
    const fired: Binding[] = []
    dispatchChanged(reg, [3, 7], (binding) => fired.push(binding))

    expect(fired).toEqual([])
  })

  it('unregister of a never-registered binding is a no-op (idempotent)', () => {
    const reg = createBindingRegistry()
    const b = makeBinding('a')
    // Should not throw.
    unregisterBinding(reg, b)
    expect(true).toBe(true)
  })

  it('re-registering the same binding overwrites its prefix-ID set', () => {
    const reg = createBindingRegistry()
    const b = makeBinding('a')
    registerBinding(reg, b, [3, 7])
    registerBinding(reg, b, [11]) // overwrite — no longer subscribed to 3/7

    const fired: Binding[] = []
    dispatchChanged(reg, [3, 7], (binding) => fired.push(binding))
    expect(fired).toEqual([])

    dispatchChanged(reg, [11], (binding) => fired.push(binding))
    expect(fired).toEqual([b])
  })

  it('dispatch preserves registration order for a single prefix', () => {
    // V8 preserves insertion order in Set; we rely on this for deterministic
    // dispatch order. Spec-guaranteed for Set since ES2015.
    const reg = createBindingRegistry()
    const bindings = [makeBinding('a'), makeBinding('b'), makeBinding('c')]
    for (const b of bindings) registerBinding(reg, b, [3])

    const fired: Binding[] = []
    dispatchChanged(reg, [3], (b) => fired.push(b))
    expect(fired).toEqual(bindings)
  })

  it('a binding registered under prefixes [3, 7] fires once when only 3 changes', () => {
    const reg = createBindingRegistry()
    const b = makeBinding('a')
    registerBinding(reg, b, [3, 7])

    const fired: Binding[] = []
    dispatchChanged(reg, [3], (binding) => fired.push(binding))

    expect(fired).toEqual([b])
  })
})
