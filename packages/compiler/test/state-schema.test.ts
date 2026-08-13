import { describe, it, expect } from 'vitest'
import { extractStateSchema } from '../src/state-schema.js'

describe('extractStateSchema', () => {
  it('extracts a `type State = { … }` alias (existing)', () => {
    expect(extractStateSchema('type State = { count: number; label: string }')).toEqual({
      fields: { count: 'number', label: 'string' },
    })
  })

  it('extracts an `interface State { … }` declaration', () => {
    const src = 'interface State { count: number; name?: string; done: boolean }'
    expect(extractStateSchema(src)).toEqual({
      fields: {
        count: 'number',
        name: { kind: 'optional', of: 'string' },
        done: 'boolean',
      },
    })
  })

  it('resolves nested interface references', () => {
    const src = [
      'interface User { name: string; age: number }',
      'interface State { user: User; tags: string[] }',
    ].join('\n')
    expect(extractStateSchema(src)).toEqual({
      fields: {
        user: { kind: 'object', fields: { name: 'string', age: 'number' } },
        tags: { kind: 'array', of: 'string' },
      },
    })
  })

  it('mixes interface State with a `type` alias field', () => {
    const src = ['type Mode = "a" | "b"', 'interface State { mode: Mode; n: number }'].join('\n')
    expect(extractStateSchema(src)).toEqual({
      fields: { mode: { kind: 'enum', values: ['a', 'b'] }, n: 'number' },
    })
  })

  it('returns null when the type/interface is absent', () => {
    expect(extractStateSchema('const x = 1')).toBeNull()
  })

  // Finding 5: a self-referential State must terminate (depth budget), not
  // recurse until a stack overflow.
  it('does not stack-overflow on a directly recursive State (interface)', () => {
    const src = 'interface State { name: string; children: State[] }'
    const schema = extractStateSchema(src)
    expect(schema).not.toBeNull()
    expect(schema!.fields.name).toBe('string')
    // `children` is an array; its element bottoms out at 'unknown' once the
    // recursion budget is spent (rather than looping forever).
    expect(schema!.fields.children).toMatchObject({ kind: 'array' })
  })

  it('does not stack-overflow on mutually recursive types', () => {
    const src = [
      'type A = { b: B; tag: string }',
      'type B = { a: A; n: number }',
      'interface State { root: A }',
    ].join('\n')
    expect(() => extractStateSchema(src)).not.toThrow()
    const schema = extractStateSchema(src)
    expect(schema).not.toBeNull()
  })
})

// Issue #88: `undefined` must be peeled OFF the union BEFORE the remainder is
// classified. Classifying first makes the literal-union scan trip over the
// `undefined` member and collapse the whole field to a union of `unknown`,
// hiding both the enum values and the optionality from agents.
describe('extractStateSchema — `T | undefined` peeling (#88)', () => {
  const field = (src: string) => extractStateSchema(`interface State { mode: ${src} }`)?.fields.mode

  it("peels `undefined` from a two-member literal union: 'a' | 'b' | undefined", () => {
    expect(field(`'a' | 'b' | undefined`)).toEqual({
      kind: 'optional',
      of: { kind: 'enum', values: ['a', 'b'] },
    })
  })

  it('peels `undefined` from a 3+ member literal union', () => {
    expect(field(`'a' | 'b' | 'c' | 'd' | undefined`)).toEqual({
      kind: 'optional',
      of: { kind: 'enum', values: ['a', 'b', 'c', 'd'] },
    })
  })

  it('peels `undefined` regardless of member order', () => {
    expect(field(`undefined | 'a' | 'b'`)).toEqual({
      kind: 'optional',
      of: { kind: 'enum', values: ['a', 'b'] },
    })
  })

  // Today's working case: a single non-undefined member. The optionality was
  // already detected; the enum value was not.
  it("peels `undefined` from a single-member literal union: 'a' | undefined", () => {
    expect(field(`'a' | undefined`)).toEqual({
      kind: 'optional',
      of: { kind: 'enum', values: ['a'] },
    })
  })

  it('still peels `undefined` off a non-literal member (no regression)', () => {
    expect(field('string | undefined')).toEqual({ kind: 'optional', of: 'string' })
    expect(field('number[] | undefined')).toEqual({
      kind: 'optional',
      of: { kind: 'array', of: 'number' },
    })
  })

  it('peels `undefined` from a mixed union, classifying the remainder', () => {
    expect(field(`'a' | number | undefined`)).toEqual({
      kind: 'optional',
      of: { kind: 'union', of: [{ kind: 'enum', values: ['a'] }, 'number'] },
    })
  })

  it('resolves a literal union reached through a type alias', () => {
    const src = ['type Mode = "a" | "b" | undefined', 'interface State { mode: Mode }'].join('\n')
    expect(extractStateSchema(src)).toEqual({
      fields: { mode: { kind: 'optional', of: { kind: 'enum', values: ['a', 'b'] } } },
    })
  })

  // `?:` and `| undefined` mean the same thing; writing both must not nest two
  // `optional` wrappers around the payload.
  it('does not double-wrap `mode?: T | undefined`', () => {
    expect(
      extractStateSchema(`interface State { mode?: 'a' | 'b' | undefined }`)?.fields.mode,
    ).toEqual({ kind: 'optional', of: { kind: 'enum', values: ['a', 'b'] } })
  })

  // Pathological: nothing survives the peel. Fall through rather than
  // fabricating an `optional` of nothing.
  it('leaves an all-`undefined` union alone', () => {
    expect(field('undefined')).toBe('unknown')
    expect(field('undefined | undefined')).toEqual({ kind: 'union', of: ['unknown', 'unknown'] })
  })
})

// Issue #88, `null` half. DECISION: `null` is a VALUE, not an absence.
// State must be JSON-serializable, and `null` survives a JSON round-trip while
// `undefined` does not — `mode: 'a' | null` is a field that is always PRESENT
// and may hold `null`, whereas `mode: 'a' | undefined` is a field that may be
// absent. So `null` is peeled out of the union for classification purposes (so
// the literal scan can still see the enum) but is re-attached as a `'null'`
// union member, NEVER as `optional`.
describe('extractStateSchema — `null` is a value, not optionality (#88)', () => {
  const field = (src: string) => extractStateSchema(`interface State { mode: ${src} }`)?.fields.mode

  it('describes a bare `null`', () => {
    expect(field('null')).toBe('null')
  })

  it('keeps `T | null` a union — never optional', () => {
    expect(field('string | null')).toEqual({ kind: 'union', of: ['string', 'null'] })
  })

  it("classifies the literal remainder of 'a' | 'b' | null", () => {
    expect(field(`'a' | 'b' | null`)).toEqual({
      kind: 'union',
      of: [{ kind: 'enum', values: ['a', 'b'] }, 'null'],
    })
  })

  it("marks 'a' | 'b' | null | undefined optional AND nullable", () => {
    expect(field(`'a' | 'b' | null | undefined`)).toEqual({
      kind: 'optional',
      of: { kind: 'union', of: [{ kind: 'enum', values: ['a', 'b'] }, 'null'] },
    })
  })

  it('handles `null | undefined` with nothing else in the union', () => {
    expect(field('null | undefined')).toEqual({ kind: 'optional', of: 'null' })
  })

  // Re-attaching `null` must SPLICE into the classified remainder when that
  // remainder is itself a union — `$ss` is read by an LLM and a union nested
  // inside a union is gratuitously harder to reason about than a flat one.
  it('flattens `null` into a general-union remainder', () => {
    expect(field('string | number | null')).toEqual({
      kind: 'union',
      of: ['string', 'number', 'null'],
    })
    expect(field(`'a' | number | null`)).toEqual({
      kind: 'union',
      of: [{ kind: 'enum', values: ['a'] }, 'number', 'null'],
    })
  })

  // …and must NOT splice anything else. A non-union remainder stays one
  // member, including compound descriptors that carry their own `of`.
  it('does not splice a non-union remainder', () => {
    expect(field('string | null')).toEqual({ kind: 'union', of: ['string', 'null'] })
    expect(field('number[] | null')).toEqual({
      kind: 'union',
      of: [{ kind: 'array', of: 'number' }, 'null'],
    })
    expect(field(`{ a: number } | null`)).toEqual({
      kind: 'union',
      of: [{ kind: 'object', fields: { a: 'number' } }, 'null'],
    })
  })

  // The flatten must not reach through the `optional` wrapper: optionality
  // stays outermost, and the union it wraps keeps its own shape.
  it('flattens under `optional` without disturbing the wrapper', () => {
    expect(field('string | number | null | undefined')).toEqual({
      kind: 'optional',
      of: { kind: 'union', of: ['string', 'number', 'null'] },
    })
  })
})
