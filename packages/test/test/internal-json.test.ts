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
  it('undefined in expected asserts the value IS undefined — it is not a wildcard', () => {
    expect(partialMatch({ a: 99 }, { a: undefined })).toBe(false)
    expect(partialMatch({ a: undefined }, { a: undefined })).toBe(true)
    // Key-absent and value-undefined are different outcomes: an expected
    // `undefined` demands the key be there.
    expect(partialMatch({ b: 1 }, { a: undefined })).toBe(false)
  })
  it('an expected undefined at the root only matches undefined', () => {
    expect(partialMatch(undefined, undefined)).toBe(true)
    expect(partialMatch(0, undefined)).toBe(false)
    expect(partialMatch({ a: 1 }, undefined)).toBe(false)
  })
  it('arrays match by index WITH a length check — no subset match', () => {
    expect(partialMatch([1, 2], [1, 2])).toBe(true)
    // Expected array is a full positional template: [1] does not match [1, 2].
    expect(partialMatch([1, 2], [1])).toBe(false)
    expect(partialMatch([1], [1, 2])).toBe(false)
  })
  it('array elements match partially (recursive)', () => {
    expect(partialMatch([{ id: 1, extra: 'z' }], [{ id: 1 }])).toBe(true)
    // undefined at a position is an assertion too — that element must be undefined.
    expect(partialMatch([{ id: 1 }, { id: 2 }], [undefined, { id: 2 }])).toBe(false)
    expect(partialMatch([undefined, { id: 2 }], [undefined, { id: 2 }])).toBe(true)
  })
  it('array vs non-array mismatches', () => {
    expect(partialMatch({ 0: 1 }, [1])).toBe(false)
  })
})

describe('partialMatch exact mode', () => {
  it('rejects an actual key the expectation does not name', () => {
    expect(partialMatch({ a: 1, b: 2 }, { a: 1 }, { exact: true })).toBe(false)
    expect(partialMatch({ a: 1 }, { a: 1 }, { exact: true })).toBe(true)
  })
  it('applies at every level the expectation reaches', () => {
    expect(partialMatch({ a: { b: 1, c: 2 } }, { a: { b: 1 } }, { exact: true })).toBe(false)
    expect(partialMatch([{ a: 1, b: 2 }], [{ a: 1 }], { exact: true })).toBe(false)
  })
  it('ignores actual keys outside the JSON projection (functions, undefined)', () => {
    expect(partialMatch({ a: 1, cb: () => {} }, { a: 1 }, { exact: true })).toBe(true)
    expect(partialMatch({ a: 1, b: undefined }, { a: 1 }, { exact: true })).toBe(true)
  })
  it('tolerates an EXTRA undefined but not a DEMANDED one (documented asymmetry)', () => {
    // Actual-side undefined is not data, so exact mode waves it through…
    expect(partialMatch({ a: 1, b: undefined }, { a: 1 }, { exact: true })).toBe(true)
    // …but expected-side undefined asserts presence, so the mirror image fails.
    expect(partialMatch({ a: 1 }, { a: 1, b: undefined }, { exact: true })).toBe(false)
  })
  it('is opt-in — the default stays partial', () => {
    expect(partialMatch({ a: 1, b: 2 }, { a: 1 })).toBe(true)
  })
  it('counts an actual key that shadows a prototype member as unexpected', () => {
    // `key in expObj` would find `toString` on Object.prototype and wave the
    // actual own key through. Presence must be OWN-key presence, the notion
    // `jsonKeys`/`jsonEqual` already use.
    expect(partialMatch({ toString: 'shadowed' }, {}, { exact: true })).toBe(false)
  })
})

describe('partialMatch key presence is OWN-key presence', () => {
  it('an inherited key does not satisfy an expected undefined', () => {
    const actual: Record<string, unknown> = {}
    Object.setPrototypeOf(actual, { a: undefined })
    // `a` reads back as `undefined` through the prototype, but the object does
    // not carry the key — the same distinction key-absent-vs-value-undefined
    // makes at the own-key level.
    expect(partialMatch(actual, { a: undefined })).toBe(false)
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
