import { describe, it, expect } from 'vitest'
import { assertEffects } from '../src/assert-effects'

type Fx = { type: 'http'; url: string; headers: string[] } | { type: 'log'; msg: string }

/** Optional fields, so a test can build an effect with a key absent OR explicitly `undefined`. */
type OptFx = { type: 'req'; url?: string; retries?: number }

/** An http-shaped effect carrying a callback — the case exact mode must not choke on. */
type CbFx = { type: 'http'; url: string; onSuccess: (body: string) => void }

/** A nested payload, to pin how deep exact mode reaches. */
type NestedFx = { type: 'post'; body: { a: number; b?: number } }

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

describe('assertEffects — an expected `undefined` is an assertion, not a wildcard', () => {
  it('fails against an effect whose field holds a value', () => {
    expect(() =>
      assertEffects<OptFx>([{ type: 'req', url: '/a' }], [{ type: 'req', url: undefined }]),
    ).toThrow(/does not match/)
  })

  it('passes against an effect whose field is explicitly undefined', () => {
    expect(() =>
      assertEffects<OptFx>([{ type: 'req', url: undefined }], [{ type: 'req', url: undefined }]),
    ).not.toThrow()
  })

  it('distinguishes an absent key from a key holding undefined', () => {
    // Key absent — `{ url: undefined }` asserts the key is THERE, so this fails.
    expect(() => assertEffects<OptFx>([{ type: 'req' }], [{ url: undefined }])).toThrow(
      /does not match/,
    )
    // Key present holding undefined — same expectation, opposite outcome.
    expect(() =>
      assertEffects<OptFx>([{ type: 'req', url: undefined }], [{ url: undefined }]),
    ).not.toThrow()
  })
})

describe('assertEffects — exact mode', () => {
  it('rejects an effect carrying a key the expectation does not name', () => {
    expect(() =>
      assertEffects<OptFx>([{ type: 'req', url: '/a', retries: 2 }], [{ type: 'req', url: '/a' }], {
        exact: true,
      }),
    ).toThrow(/does not match/)
  })

  it('accepts an effect whose keys are exactly the expected ones', () => {
    expect(() =>
      assertEffects<OptFx>([{ type: 'req', url: '/a' }], [{ type: 'req', url: '/a' }], {
        exact: true,
      }),
    ).not.toThrow()
  })

  it('leaves the default path partial — extras are still ignored', () => {
    expect(() =>
      assertEffects<OptFx>([{ type: 'req', url: '/a', retries: 2 }], [{ type: 'req', url: '/a' }]),
    ).not.toThrow()
  })

  it("ignores callback fields — they are not part of an effect's JSON data", () => {
    expect(() =>
      assertEffects<CbFx>(
        [{ type: 'http', url: '/a', onSuccess: () => {} }],
        [{ type: 'http', url: '/a' }],
        { exact: true },
      ),
    ).not.toThrow()
  })

  it('reaches every level the expectation describes', () => {
    expect(() =>
      assertEffects<NestedFx>(
        [{ type: 'post', body: { a: 1, b: 2 } }],
        [{ type: 'post', body: { a: 1 } }],
        { exact: true },
      ),
    ).toThrow(/does not match/)
    // The same nested expectation is fine under the default partial mode.
    expect(() =>
      assertEffects<NestedFx>(
        [{ type: 'post', body: { a: 1, b: 2 } }],
        [{ type: 'post', body: { a: 1 } }],
      ),
    ).not.toThrow()
  })
})
