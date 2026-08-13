import { describe, it, expect, vi } from 'vitest'
import { deriveOnce, indexMap, membershipSet } from '../../src/utils/derive'

describe('deriveOnce', () => {
  it('recomputes only when an argument identity changes', () => {
    const compute = vi.fn((values: readonly string[]) => values.length)
    const derive = deriveOnce(compute)
    const a = ['x', 'y']
    expect(derive(a)).toBe(2)
    expect(derive(a)).toBe(2)
    expect(derive(a)).toBe(2)
    expect(compute).toHaveBeenCalledTimes(1)
    // A NEW array with the same contents is a new state — update() is pure, so
    // identity is the change signal the whole runtime already uses.
    expect(derive(['x', 'y'])).toBe(2)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('watches every argument', () => {
    const compute = vi.fn((items: readonly string[], disabled: readonly string[]) =>
      items.filter((i) => !disabled.includes(i)),
    )
    const derive = deriveOnce(compute)
    const items = ['a', 'b']
    const disabled = ['b']
    expect(derive(items, disabled)).toEqual(['a'])
    expect(derive(items, disabled)).toEqual(['a'])
    expect(compute).toHaveBeenCalledTimes(1)
    expect(derive(items, [])).toEqual(['a', 'b'])
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('caches a primitive argument by value', () => {
    const compute = vi.fn((n: number) => n * 2)
    const derive = deriveOnce(compute)
    expect(derive(2)).toBe(4)
    expect(derive(2)).toBe(4)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('keeps one cell per call to deriveOnce, so instances never share', () => {
    const compute = vi.fn((values: readonly string[]) => values.length)
    const one = deriveOnce(compute)
    const two = deriveOnce(compute)
    const a = ['x']
    one(a)
    two(a)
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

describe('membershipSet', () => {
  it('answers membership and rebuilds only on identity change', () => {
    const lookup = membershipSet<string>()
    const values = ['a', 'b']
    const first = lookup(values)
    expect(first.has('a')).toBe(true)
    expect(first.has('z')).toBe(false)
    expect(lookup(values)).toBe(first)
    expect(lookup(['a', 'b'])).not.toBe(first)
  })

  it('treats a missing collection as empty', () => {
    const lookup = membershipSet<string>()
    expect(lookup(undefined).has('a')).toBe(false)
    expect(lookup(undefined).size).toBe(0)
  })
})

describe('indexMap', () => {
  it('maps a value to its position, first occurrence winning', () => {
    const lookup = indexMap<string>()
    const positions = lookup(['a', 'b', 'a'])
    expect(positions.get('a')).toBe(0)
    expect(positions.get('b')).toBe(1)
    expect(positions.get('z')).toBeUndefined()
  })

  it('rebuilds only on identity change', () => {
    const lookup = indexMap<string>()
    const values = ['a']
    expect(lookup(values)).toBe(lookup(values))
  })
})
