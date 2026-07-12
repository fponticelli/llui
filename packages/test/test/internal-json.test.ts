import { describe, it, expect } from 'vitest'
import { jsonEqual, jsonDiff, partialMatch } from '../src/internal/json'

describe('jsonEqual', () => {
  it('compares primitives, arrays, and nested objects structurally', () => {
    expect(jsonEqual(1, 1)).toBe(true)
    expect(jsonEqual({ a: [1, 2], b: { c: 3 } }, { a: [1, 2], b: { c: 3 } })).toBe(true)
    expect(jsonEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
  it('distinguishes array from object', () => {
    expect(jsonEqual([], {})).toBe(false)
  })
  it('treats null distinctly', () => {
    expect(jsonEqual(null, null)).toBe(true)
    expect(jsonEqual(null, {})).toBe(false)
  })
})

describe('partialMatch array semantics', () => {
  it('matches nested objects partially', () => {
    expect(partialMatch({ type: 'x', a: 1, b: 2 }, { type: 'x' })).toBe(true)
    expect(partialMatch({ type: 'x' }, { type: 'y' })).toBe(false)
  })
  it('undefined in expected is a wildcard', () => {
    expect(partialMatch({ a: 99 }, { a: undefined })).toBe(true)
  })
  it('arrays match by index WITH a length check — no subset match', () => {
    expect(partialMatch([1, 2], [1, 2])).toBe(true)
    // Expected array is a full positional template: [1] does not match [1, 2].
    expect(partialMatch([1, 2], [1])).toBe(false)
    expect(partialMatch([1], [1, 2])).toBe(false)
  })
  it('array elements match partially (recursive)', () => {
    expect(partialMatch([{ id: 1, extra: 'z' }], [{ id: 1 }])).toBe(true)
    // undefined leaves a position unconstrained
    expect(partialMatch([{ id: 1 }, { id: 2 }], [undefined, { id: 2 }])).toBe(true)
  })
  it('array vs non-array mismatches', () => {
    expect(partialMatch({ 0: 1 }, [1])).toBe(false)
  })
})

describe('jsonDiff', () => {
  it('empty when equal', () => {
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([])
  })
  it('replace on a changed leaf', () => {
    expect(jsonDiff({ a: 1 }, { a: 2 })).toEqual([{ op: 'replace', path: '/a', value: 2 }])
  })
  it('add / remove object keys', () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 })).toEqual([{ op: 'add', path: '/b', value: 2 }])
    expect(jsonDiff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ op: 'remove', path: '/b' }])
  })
  it('array growth adds at landing index; shrink removes from the end', () => {
    expect(jsonDiff([1], [1, 2])).toEqual([{ op: 'add', path: '/1', value: 2 }])
    expect(jsonDiff([1, 2], [1])).toEqual([{ op: 'remove', path: '/1' }])
  })
  it('escapes JSON-Pointer special chars in keys', () => {
    expect(jsonDiff({ 'a/b': 1 }, { 'a/b': 2 })).toEqual([
      { op: 'replace', path: '/a~1b', value: 2 },
    ])
  })
})
