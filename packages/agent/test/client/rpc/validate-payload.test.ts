import { describe, it, expect } from 'vitest'
import { validatePayload } from '../../../src/client/rpc/validate-payload.js'
import type { MsgSchemaShape } from '../../../src/client/factory.js'

const setRating: MsgSchemaShape = {
  discriminant: 'type',
  variants: {
    'Cell/SetRating': { value: { enum: [1, 2, 3, 4, 5] } },
  },
}

const setFormat: MsgSchemaShape = {
  discriminant: 'type',
  variants: {
    'Cell/SetFormat': {
      format: {
        kind: 'discriminated-union',
        discriminant: 'kind',
        variants: {
          exact: {},
          range: { min: 'number', max: 'number' },
          compound: { formula: 'string' },
        },
      },
    },
  },
}

describe('validatePayload', () => {
  // ── Top-level structure ────────────────────────────────────────

  it('rejects non-object msg', () => {
    const r = validatePayload(null, setRating)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.code).toBe('not-object')
  })

  it('rejects msg without a string `type`', () => {
    const r = validatePayload({}, setRating)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.code).toBe('missing')
  })

  it('rejects msg whose type is not a known variant', () => {
    const r = validatePayload({ type: 'Bogus' }, setRating)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('unknown-variant')
      expect(r.errors[0]?.message).toContain('Cell/SetRating')
    }
  })

  it('accepts valid msg', () => {
    const r = validatePayload({ type: 'Cell/SetRating', value: 3 }, setRating)
    expect(r).toEqual({ ok: true })
  })

  it('accepts msg without a schema (schema null)', () => {
    // Schema absent — fall back to "structurally valid" means "is an
    // object with a string type". The reducer enforces semantics.
    const r = validatePayload({ type: 'X', anything: 1 }, null)
    expect(r).toEqual({ ok: true })
  })

  // ── Enum validation ───────────────────────────────────────────

  it('rejects out-of-enum values with the legal list', () => {
    const r = validatePayload({ type: 'Cell/SetRating', value: 6 }, setRating)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toEqual({
        path: 'value',
        code: 'not-in-enum',
        message: "'6' is not in the enum. Legal values: 1, 2, 3, 4, 5.",
      })
    }
  })

  it('accepts a numeric enum value (preserves type)', () => {
    const r = validatePayload({ type: 'Cell/SetRating', value: 4 }, setRating)
    expect(r).toEqual({ ok: true })
  })

  it("rejects a string '4' against a numeric enum (no coercion)", () => {
    // The compiler emits enum values with their native type. The
    // validator does not coerce — '4' is a string, not a number.
    const r = validatePayload({ type: 'Cell/SetRating', value: '4' }, setRating)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.code).toBe('not-in-enum')
  })

  // ── Required / optional fields ────────────────────────────────

  it('rejects msg missing a required field', () => {
    const r = validatePayload({ type: 'Cell/SetRating' }, setRating)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'value',
        code: 'missing',
      })
    }
  })

  it('accepts msg without an optional field', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        Save: {
          title: 'string',
          description: { type: 'string', optional: true },
        },
      },
    }
    const r = validatePayload({ type: 'Save', title: 't' }, schema)
    expect(r).toEqual({ ok: true })
  })

  // ── Primitive type mismatches ─────────────────────────────────

  it('rejects wrong primitive type with describable diagnosis', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { Add: { count: 'number' } },
    }
    const r = validatePayload({ type: 'Add', count: 'three' }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'count',
        code: 'wrong-type',
        message: 'expected number, got string',
      })
    }
  })

  it('treats `unknown` schema fields as accepting anything', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { X: { payload: 'unknown' } },
    }
    expect(validatePayload({ type: 'X', payload: 42 }, schema)).toEqual({ ok: true })
    expect(validatePayload({ type: 'X', payload: { a: 1 } }, schema)).toEqual({ ok: true })
    expect(validatePayload({ type: 'X', payload: null }, schema)).toEqual({ ok: true })
  })

  // ── Discriminated unions ──────────────────────────────────────

  it('accepts a valid discriminated-union branch', () => {
    const r = validatePayload(
      { type: 'Cell/SetFormat', format: { kind: 'range', min: 0, max: 100 } },
      setFormat,
    )
    expect(r).toEqual({ ok: true })
  })

  it('rejects a discriminated-union value missing the discriminant', () => {
    const r = validatePayload({ type: 'Cell/SetFormat', format: {} }, setFormat)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'format.kind',
        code: 'missing-discriminant',
      })
      expect(r.errors[0]?.message).toContain('exact')
      expect(r.errors[0]?.message).toContain('range')
      expect(r.errors[0]?.message).toContain('compound')
    }
  })

  it('rejects an unknown discriminant value with the legal list', () => {
    const r = validatePayload(
      { type: 'Cell/SetFormat', format: { kind: 'logarithmic', base: 10 } },
      setFormat,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'format.kind',
        code: 'unknown-discriminant-value',
      })
    }
  })

  it('reports per-branch field errors with the disambiguating path', () => {
    // Sending {kind: 'range', max: 100} — missing `min`. Path includes
    // `(kind=range)` so the agent knows it's the range branch's field.
    const r = validatePayload(
      { type: 'Cell/SetFormat', format: { kind: 'range', max: 100 } },
      setFormat,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'format(kind=range).min',
        code: 'missing',
      })
    }
  })

  // ── Arrays ────────────────────────────────────────────────────

  it('rejects non-array against an array-typed field', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { Add: { items: { kind: 'array', element: 'string' } } },
    }
    const r = validatePayload({ type: 'Add', items: 'not-an-array' }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.code).toBe('not-array')
  })

  it('reports each invalid array element with its index', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { Add: { items: { kind: 'array', element: 'number' } } },
    }
    const r = validatePayload({ type: 'Add', items: [1, 'two', 3, 'four'] }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(2)
      expect(r.errors[0]?.path).toBe('items[1]')
      expect(r.errors[1]?.path).toBe('items[3]')
    }
  })

  // ── Multiple errors collected in one pass ─────────────────────

  it('collects all errors before returning', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { X: { a: 'string', b: 'number' } },
    }
    const r = validatePayload({ type: 'X', a: 1, b: 'two' }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(2)
      expect(r.errors[0]?.path).toBe('a')
      expect(r.errors[1]?.path).toBe('b')
    }
  })
})
