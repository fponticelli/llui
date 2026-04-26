import { describe, it, expect } from 'vitest'
import { handleQueryState } from '../../../src/client/rpc/query-state.js'

const mkHost = (state: unknown) => ({ getState: () => state })

describe('handleQueryState', () => {
  it('empty path returns the whole state', () => {
    const state = { a: 1, b: { c: 2 } }
    expect(handleQueryState(mkHost(state), { path: '' })).toEqual({
      found: true,
      value: state,
    })
  })

  it('single-segment path resolves a top-level key', () => {
    expect(handleQueryState(mkHost({ user: 'alice' }), { path: '/user' })).toEqual({
      found: true,
      value: 'alice',
    })
  })

  it('nested path walks through objects', () => {
    expect(
      handleQueryState(mkHost({ auth: { user: { id: 'u1' } } }), {
        path: '/auth/user/id',
      }),
    ).toEqual({ found: true, value: 'u1' })
  })

  it('numeric segment indexes into an array', () => {
    expect(handleQueryState(mkHost([10, 20, 30]), { path: '/1' })).toEqual({
      found: true,
      value: 20,
    })
  })

  it('mixed object/array walk', () => {
    expect(
      handleQueryState(mkHost({ items: [{ id: 'a' }, { id: 'b' }] }), {
        path: '/items/1/id',
      }),
    ).toEqual({ found: true, value: 'b' })
  })

  it('missing key returns found: false with a detail', () => {
    const r = handleQueryState(mkHost({ a: 1 }), { path: '/missing' })
    expect(r.found).toBe(false)
    if (!r.found) expect(r.detail).toContain('missing')
  })

  it('out-of-bounds array index returns found: false', () => {
    const r = handleQueryState(mkHost({ items: [1, 2] }), { path: '/items/5' })
    expect(r.found).toBe(false)
  })

  it('walking through null returns found: false', () => {
    const r = handleQueryState(mkHost({ a: null }), { path: '/a/b' })
    expect(r.found).toBe(false)
    if (!r.found) expect(r.detail).toContain('null')
  })

  it('walking through a primitive returns found: false', () => {
    const r = handleQueryState(mkHost({ a: 5 }), { path: '/a/b' })
    expect(r.found).toBe(false)
  })

  it('unescapes ~1 → / in segment', () => {
    expect(handleQueryState(mkHost({ 'a/b': 'value' }), { path: '/a~1b' })).toEqual({
      found: true,
      value: 'value',
    })
  })

  it('unescapes ~0 → ~ in segment', () => {
    expect(handleQueryState(mkHost({ 'c~d': 'value' }), { path: '/c~0d' })).toEqual({
      found: true,
      value: 'value',
    })
  })

  it('handles ~ followed by 1 in original key (round-trip with state-diff escaping)', () => {
    // The escaping rule preserves any literal `~1` in a key as
    // `~01`. Decoding `~01` should restore the literal `~1`.
    expect(handleQueryState(mkHost({ '~1': 'literal' }), { path: '/~01' })).toEqual({
      found: true,
      value: 'literal',
    })
  })

  it('rejects malformed path (no leading slash) with found: false', () => {
    // RFC 6901 requires a leading `/` for non-empty paths.
    const r = handleQueryState(mkHost({ a: 1 }), { path: 'a' })
    expect(r.found).toBe(false)
    if (!r.found) expect(r.detail).toContain('start with')
  })

  it('returns null values successfully (null is a valid value)', () => {
    // Distinct from the not-found case: a key that exists with a
    // null value resolves to found:true, value:null. Lets the agent
    // distinguish "field is null" from "field doesn't exist."
    expect(handleQueryState(mkHost({ user: null }), { path: '/user' })).toEqual({
      found: true,
      value: null,
    })
  })
})
