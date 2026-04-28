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

  // ── Strict mode ────────────────────────────────────────────────

  it('strict mode rejects fields not in the schema', () => {
    // The agent typo'd `tilte` for `title` — lenient mode passes it
    // through; strict mode catches it. Hallucinated extra fields land
    // here too.
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { Save: { title: 'string' } },
    }
    const r = validatePayload({ type: 'Save', title: 'X', tilte: 'X' }, schema, {
      policy: 'strict',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'tilte',
        code: 'unexpected-field',
      })
    }
  })

  it('lenient mode (default) accepts extras silently', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { Save: { title: 'string' } },
    }
    expect(validatePayload({ type: 'Save', title: 'X', extra: 1 }, schema)).toEqual({ ok: true })
    expect(
      validatePayload({ type: 'Save', title: 'X', extra: 1 }, schema, { policy: 'lenient' }),
    ).toEqual({ ok: true })
  })

  it('strict mode warns when the agent provides a value for an `unknown`-typed field', () => {
    // `unknown` schema entries usually mean cross-file resolution
    // didn't reach that deep — the field IS expected, just untyped.
    // Strict mode accepts the value (we can't validate it) but
    // surfaces the gap as a warning so the LLM knows it wasn't
    // checked. Lenient mode stays silent.
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: { X: { payload: 'unknown' } },
    }
    const strict = validatePayload({ type: 'X', payload: { whatever: 1 } }, schema, {
      policy: 'strict',
    })
    expect(strict.ok).toBe(true)
    if (strict.ok) {
      expect(strict.warnings).toEqual([
        {
          path: 'payload',
          code: 'untyped-field',
          message: expect.stringContaining("'unknown'"),
        },
      ])
    }

    const lenient = validatePayload({ type: 'X', payload: { whatever: 1 } }, schema)
    expect(lenient).toEqual({ ok: true }) // no warnings field in lenient
  })

  it('strict mode catches typos in nested object shapes', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        Save: {
          row: {
            kind: 'object',
            shape: { id: 'string', label: 'string' },
          },
        },
      },
    }
    const r = validatePayload({ type: 'Save', row: { id: 'r1', lable: 'hello' } }, schema, {
      policy: 'strict',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Two errors expected: `label` is missing (typo became `lable`)
      // AND `lable` is an unexpected field.
      expect(r.errors).toContainEqual(
        expect.objectContaining({ path: 'row.label', code: 'missing' }),
      )
      expect(r.errors).toContainEqual(
        expect.objectContaining({ path: 'row.lable', code: 'unexpected-field' }),
      )
    }
  })

  // ── @validates predicate ──────────────────────────────────────

  it('rejects values that fail the @validates predicate', () => {
    // weight: number with @validates("v >= 0 && v <= 100"). Any
    // value outside the range is rejected with a clear pointer at
    // the predicate source.
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        SetWeight: {
          weight: { type: 'number', validates: 'v >= 0 && v <= 100' },
        },
      },
    }
    expect(validatePayload({ type: 'SetWeight', weight: 50 }, schema)).toEqual({ ok: true })
    const r = validatePayload({ type: 'SetWeight', weight: 150 }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({
        path: 'weight',
        code: 'validates-failed',
        message: expect.stringContaining('v >= 0 && v <= 100'),
      })
    }
  })

  it('@validates fires after structural validation passes', () => {
    // Structural error trumps the predicate — if the value isn't even
    // the right type, we don't try to evaluate the predicate.
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        X: {
          weight: { type: 'number', validates: 'v >= 0' },
        },
      },
    }
    const r = validatePayload({ type: 'X', weight: 'a string' }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe('wrong-type')
      expect(r.errors.some((e) => e.code === 'validates-failed')).toBe(false)
    }
  })

  it('@validates supports regex predicates for format checks', () => {
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        SetSlug: {
          slug: { type: 'string', validates: '/^[a-z0-9-]+$/.test(v)' },
        },
      },
    }
    expect(validatePayload({ type: 'SetSlug', slug: 'my-cool-slug' }, schema)).toEqual({
      ok: true,
    })
    const r = validatePayload({ type: 'SetSlug', slug: 'My Slug!' }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors[0]).toMatchObject({ path: 'slug', code: 'validates-failed' })
    }
  })

  it('@validates: a malformed predicate is treated as accept (no break)', () => {
    // Build-time lint is the right place to catch syntactic issues;
    // runtime degrades gracefully so a single typo doesn't paralyze
    // every dispatch.
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        X: {
          weight: { type: 'number', validates: 'v >= 0 &&' }, // syntax error
        },
      },
    }
    const r = validatePayload({ type: 'X', weight: 50 }, schema)
    expect(r.ok).toBe(true)
  })

  it('@validates: a predicate that throws at evaluation is treated as fail', () => {
    // If the predicate throws on a particular value (e.g. v.length on
    // null), we fail closed — the value clearly isn't what the author
    // expected.
    const schema: MsgSchemaShape = {
      discriminant: 'type',
      variants: {
        X: {
          payload: { type: 'unknown', validates: 'v.length > 0' },
        },
      },
    }
    const r = validatePayload({ type: 'X', payload: null }, schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]?.code).toBe('validates-failed')
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
