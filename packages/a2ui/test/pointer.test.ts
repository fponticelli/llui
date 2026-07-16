import { describe, it, expect } from 'vitest'
import type { JsonValue } from '../src/protocol.js'
import { resolvePointer, applyPointer, pointerTokens } from '../src/pointer.js'

describe('pointerTokens', () => {
  it('treats "" and "/" as the root (no tokens)', () => {
    expect(pointerTokens('')).toEqual([])
    expect(pointerTokens('/')).toEqual([])
  })

  it('splits absolute pointers', () => {
    expect(pointerTokens('/user/name')).toEqual(['user', 'name'])
    expect(pointerTokens('/items/0/name')).toEqual(['items', '0', 'name'])
  })

  it('splits relative (scoped) pointers with no leading slash', () => {
    expect(pointerTokens('name')).toEqual(['name'])
    expect(pointerTokens('address/city')).toEqual(['address', 'city'])
  })

  it('unescapes ~1 → / and ~0 → ~ per RFC 6901', () => {
    expect(pointerTokens('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
  })
})

describe('resolvePointer', () => {
  const model: JsonValue = {
    user: { name: 'Jane', profile: { age: 30 } },
    items: [{ name: 'A' }, { name: 'B' }],
    title: 'Hello',
  }

  it('returns the whole model for root', () => {
    expect(resolvePointer(model, '/')).toBe(model)
    expect(resolvePointer(model, '')).toBe(model)
  })

  it('resolves nested object paths', () => {
    expect(resolvePointer(model, '/user/name')).toBe('Jane')
    expect(resolvePointer(model, '/user/profile/age')).toBe(30)
  })

  it('resolves array indices', () => {
    expect(resolvePointer(model, '/items/1/name')).toBe('B')
  })

  it('resolves relative paths (used inside template scope)', () => {
    const item: JsonValue = { name: 'A', tags: ['x'] }
    expect(resolvePointer(item, 'name')).toBe('A')
    expect(resolvePointer(item, 'tags/0')).toBe('x')
  })

  it('returns undefined for missing paths', () => {
    expect(resolvePointer(model, '/user/missing')).toBeUndefined()
    expect(resolvePointer(model, '/items/9/name')).toBeUndefined()
    expect(resolvePointer(model, '/title/nope')).toBeUndefined()
  })
})

describe('applyPointer (immutable upsert)', () => {
  it('replaces the whole model at root', () => {
    const next = applyPointer({ a: 1 }, '/', { b: 2 })
    expect(next).toEqual({ b: 2 })
  })

  it('updates an existing scalar without mutating the input', () => {
    const model = { user: { name: 'Jane' } }
    const next = applyPointer(model, '/user/name', 'John')
    expect(next).toEqual({ user: { name: 'John' } })
    expect(model).toEqual({ user: { name: 'Jane' } }) // unchanged
  })

  it('creates intermediate objects for non-existing paths', () => {
    const next = applyPointer({}, '/a/b/c', 42)
    expect(next).toEqual({ a: { b: { c: 42 } } })
  })

  it('creates arrays when the next token is a numeric index', () => {
    const next = applyPointer({}, '/items/0/name', 'A')
    expect(next).toEqual({ items: [{ name: 'A' }] })
    expect(Array.isArray((next as { items: unknown }).items)).toBe(true)
  })

  it('sets a whole array', () => {
    const next = applyPointer({ title: 'x' }, '/items', [{ name: 'A' }, { name: 'B' }])
    expect(next).toEqual({ title: 'x', items: [{ name: 'A' }, { name: 'B' }] })
  })

  it('removes an object key when value is undefined', () => {
    const next = applyPointer({ a: 1, b: 2 }, '/b', undefined)
    expect(next).toEqual({ a: 1 })
  })

  it('shares structure for untouched siblings', () => {
    const model = { keep: { deep: 1 }, change: 0 }
    const next = applyPointer(model, '/change', 5) as typeof model
    expect(next.keep).toBe(model.keep) // structural sharing
    expect(next.change).toBe(5)
  })

  it('rejects an out-of-range array index instead of ballooning the array (fix 3)', () => {
    const next = applyPointer({ items: ['a'] }, '/items/999999999', 'x') as { items: unknown[] }
    // The write is refused; the array keeps its original length (no OOM).
    expect(next.items.length).toBe(1)
    expect(next.items).toEqual(['a'])
  })

  it('allows appending at the end of an array', () => {
    const next = applyPointer({ items: ['a'] }, '/items/1', 'b') as { items: unknown[] }
    expect(next.items).toEqual(['a', 'b'])
  })

  it('rejects an index at/over the absolute cap', () => {
    const next = applyPointer({}, '/items/100000', 'x') as { items?: unknown[] }
    // Nothing created for an out-of-range write into a fresh array.
    expect(next.items ?? []).toEqual([])
  })

  it('refuses a non-index token targeting an array and preserves the array (fix 1)', () => {
    const model = { items: ['a', 'b'] }
    const next = applyPointer(model, '/items/foo', 'x') as { items: unknown[] }
    // The array is NOT clobbered into an object — the write is refused.
    expect(Array.isArray(next.items)).toBe(true)
    expect(next.items).toEqual(['a', 'b'])
  })

  it('refuses a non-index token deep inside an array without losing the array', () => {
    const model = { items: ['a', 'b'] }
    const next = applyPointer(model, '/items/foo/bar', 'x') as { items: unknown[] }
    expect(next.items).toEqual(['a', 'b'])
  })

  it('appends with "-" at the end of an array (RFC 6901)', () => {
    expect(applyPointer({ items: ['a'] }, '/items/-', 'b')).toEqual({ items: ['a', 'b'] })
    // Creates a fresh array when the slot is empty.
    expect(applyPointer({}, '/items/-', 'first')).toEqual({ items: ['first'] })
  })

  it('refuses to write __proto__/constructor/prototype tokens (fix 4)', () => {
    const proto = applyPointer({}, '/__proto__/polluted', true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined()
    // The dangerous intermediate write is dropped, not applied.
    expect(proto).toEqual({})

    const ctor = applyPointer({ a: 1 }, '/constructor', 'x') as Record<string, unknown>
    expect(ctor.constructor).not.toBe('x')
  })
})
