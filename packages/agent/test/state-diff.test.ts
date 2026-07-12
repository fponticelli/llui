import { describe, it, expect } from 'vitest'
import { computeStateDiff } from '../src/state-diff.js'
import {
  computeStateDiff as computeStateDiffPublic,
  type StateDiff as StateDiffPublic,
} from '../src/protocol.js'

describe('computeStateDiff public export (@llui/agent/protocol)', () => {
  it('re-exports the SAME implementation from the public protocol subpath', () => {
    // Finding 17: consumers (e.g. @llui/test) import this instead of
    // replicating the algorithm. Parity is by identity — same function.
    expect(computeStateDiffPublic).toBe(computeStateDiff)
    const diff: StateDiffPublic = computeStateDiffPublic({ a: 1 }, { a: 2 })
    expect(diff).toEqual([{ op: 'replace', path: '/a', value: 2 }])
  })
})

describe('computeStateDiff', () => {
  it('empty diff for identical states (Object.is)', () => {
    const s = { a: 1, b: { c: 2 } }
    expect(computeStateDiff(s, s)).toEqual([])
  })

  it('empty diff for structurally equal but separate states', () => {
    expect(computeStateDiff({ a: 1 }, { a: 1 })).toEqual([])
  })

  it('replace at root for primitive change', () => {
    expect(computeStateDiff(5, 7)).toEqual([{ op: 'replace', path: '', value: 7 }])
  })

  it('replace nested primitive', () => {
    const prev = { count: 0 }
    const next = { count: 5 }
    expect(computeStateDiff(prev, next)).toEqual([{ op: 'replace', path: '/count', value: 5 }])
  })

  it('add new top-level key', () => {
    expect(computeStateDiff({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { op: 'add', path: '/b', value: 2 },
    ])
  })

  it('remove top-level key', () => {
    expect(computeStateDiff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ op: 'remove', path: '/b' }])
  })

  it('escapes / and ~ in path segments per RFC 6901', () => {
    // `~` → `~0`, `/` → `~1`. The `~` replacement must run first so
    // a key like `a/b` doesn't double-escape into `a~01b`.
    const prev = { 'a/b': 1, 'c~d': 2 }
    const next = { 'a/b': 99, 'c~d': 99 }
    const ops = computeStateDiff(prev, next)
    expect(ops).toContainEqual({ op: 'replace', path: '/a~1b', value: 99 })
    expect(ops).toContainEqual({ op: 'replace', path: '/c~0d', value: 99 })
  })

  it('arrays: index-based replace for value at same index', () => {
    expect(computeStateDiff([1, 2, 3], [1, 99, 3])).toEqual([
      { op: 'replace', path: '/1', value: 99 },
    ])
  })

  it('arrays: append shows as add at the new index', () => {
    expect(computeStateDiff([1, 2], [1, 2, 3])).toEqual([{ op: 'add', path: '/2', value: 3 }])
  })

  it('arrays: shrink shows as remove from the end (descending index order)', () => {
    expect(computeStateDiff([1, 2, 3], [1])).toEqual([
      { op: 'remove', path: '/2' },
      { op: 'remove', path: '/1' },
    ])
  })

  it('object↔array type change at a path → single replace, no recursion', () => {
    // Recursing into mismatched containers would emit a wall of
    // incoherent ops; treat the whole subtree as replaced.
    const prev = { items: { a: 1 } }
    const next = { items: [1, 2, 3] }
    expect(computeStateDiff(prev, next)).toEqual([
      { op: 'replace', path: '/items', value: [1, 2, 3] },
    ])
  })

  it('nested object: only the changed path emits an op', () => {
    // The whole point of structural diffing — siblings that didn't
    // change don't appear in the diff.
    const prev = {
      auth: { user: 'alice', expiry: 100 },
      grid: { sort: 'rank' },
    }
    const next = {
      auth: { user: 'alice', expiry: 200 },
      grid: { sort: 'rank' },
    }
    expect(computeStateDiff(prev, next)).toEqual([
      { op: 'replace', path: '/auth/expiry', value: 200 },
    ])
  })

  it('null and undefined are treated as primitives at any path', () => {
    expect(computeStateDiff({ a: null }, { a: { b: 1 } })).toEqual([
      { op: 'replace', path: '/a', value: { b: 1 } },
    ])
    expect(computeStateDiff({ a: { b: 1 } }, { a: null })).toEqual([
      { op: 'replace', path: '/a', value: null },
    ])
    expect(computeStateDiff({ a: undefined }, { a: 5 })).toEqual([
      { op: 'replace', path: '/a', value: 5 },
    ])
  })

  it('matrix-style update: adding entries to a keyed map', () => {
    // Simulates the realistic decisive.space-2 case: matrix.criteria
    // is a `Record<string, Criterion>`. Adding 6 criteria should
    // emit 6 add ops, not a single replace at /matrix/criteria.
    const prev = {
      matrix: { criteria: {}, alternatives: {} },
    }
    const next = {
      matrix: {
        criteria: {
          'crit-msrp': { id: 'crit-msrp', title: 'Price' },
          'crit-range': { id: 'crit-range', title: 'EPA range' },
        },
        alternatives: {},
      },
    }
    const ops = computeStateDiff(prev, next)
    expect(ops).toHaveLength(2)
    expect(ops).toContainEqual({
      op: 'add',
      path: '/matrix/criteria/crit-msrp',
      value: { id: 'crit-msrp', title: 'Price' },
    })
    expect(ops).toContainEqual({
      op: 'add',
      path: '/matrix/criteria/crit-range',
      value: { id: 'crit-range', title: 'EPA range' },
    })
  })

  it('array of objects: structural diff descends per-element', () => {
    const prev = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]
    const next = [
      { id: 'a', value: 99 }, // changed
      { id: 'b', value: 2 }, // unchanged
    ]
    expect(computeStateDiff(prev, next)).toEqual([{ op: 'replace', path: '/0/value', value: 99 }])
  })
})
