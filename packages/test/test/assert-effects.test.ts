import { describe, it, expect } from 'vitest'
import { assertEffects } from '../src/assert-effects'

type Fx = { type: 'http'; url: string; headers: string[] } | { type: 'log'; msg: string }

describe('assertEffects', () => {
  it('partial-matches effect objects, ignoring unspecified fields', () => {
    expect(() =>
      assertEffects<Fx>(
        [{ type: 'http', url: '/a', headers: ['x'] }],
        [{ type: 'http', url: '/a' }],
      ),
    ).not.toThrow()
  })

  it('enforces list length', () => {
    expect(() => assertEffects<Fx>([{ type: 'log', msg: 'a' }], [])).toThrow(/Expected 0 effects/)
  })

  it('nested arrays match by index with a length check', () => {
    // Same length + same elements — matches.
    expect(() =>
      assertEffects<Fx>(
        [{ type: 'http', url: '/a', headers: ['x', 'y'] }],
        [{ type: 'http', headers: ['x', 'y'] }],
      ),
    ).not.toThrow()
    // Different length — the nested-array length check now rejects it.
    expect(() =>
      assertEffects<Fx>(
        [{ type: 'http', url: '/a', headers: ['x', 'y'] }],
        [{ type: 'http', headers: ['x'] }],
      ),
    ).toThrow(/does not match/)
  })
})
