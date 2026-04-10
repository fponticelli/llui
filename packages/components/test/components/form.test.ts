import { describe, it, expect, vi } from 'vitest'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  init,
  update,
  connect,
  validateSchema,
  validateSchemaAsync,
} from '../../src/components/form'
import type { FormState } from '../../src/components/form'

// ── Test schemas ────────────────────────────────────────────────
// Mock Standard Schema implementations — avoids requiring Zod/Valibot
// in the test suite. Real apps bring their own validation library.

type Values = { email: string; password: string; name: string }

function makeSchema(
  validate: (values: unknown) => StandardSchemaV1.Result<Values>,
): StandardSchemaV1<Values> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate,
    },
  }
}

const successSchema = makeSchema(
  () => ({ value: { email: 'a', password: 'b', name: 'c' } }) as StandardSchemaV1.Result<Values>,
)

const failureSchema = makeSchema(
  () =>
    ({
      issues: [
        { message: 'Invalid email', path: ['email'] },
        { message: 'Password too short', path: ['password'] },
        { message: 'Name required', path: ['name'] },
      ],
    }) as StandardSchemaV1.Result<Values>,
)

const asyncSchema: StandardSchemaV1<Values> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => Promise.resolve({ value: { email: 'a', password: 'b', name: 'c' } }),
  },
}

// ── Reducer tests ───────────────────────────────────────────────

describe('form reducer', () => {
  it('initializes idle with empty touched and errors', () => {
    expect(init()).toEqual({
      status: 'idle',
      touched: {},
      submitError: null,
    })
  })

  it('touch marks a field as touched', () => {
    const [s] = update(init(), { type: 'touch', field: 'email' })
    expect(s.touched).toEqual({ email: true })
  })

  it('touch is idempotent (same reference if already touched)', () => {
    const [once] = update(init(), { type: 'touch', field: 'email' })
    const [twice] = update(once, { type: 'touch', field: 'email' })
    expect(twice).toBe(once)
  })

  it('touchAll marks multiple fields', () => {
    const [s] = update(init(), { type: 'touchAll', fields: ['email', 'password'] })
    expect(s.touched).toEqual({ email: true, password: true })
  })

  it('submit transitions to submitting', () => {
    const [s] = update(init(), { type: 'submit' })
    expect(s.status).toBe('submitting')
  })

  it('submitSuccess transitions to submitted', () => {
    const submitting: FormState = { status: 'submitting', touched: {}, submitError: null }
    const [s] = update(submitting, { type: 'submitSuccess' })
    expect(s.status).toBe('submitted')
  })

  it('submitError transitions to error with message', () => {
    const submitting: FormState = { status: 'submitting', touched: {}, submitError: null }
    const [s] = update(submitting, { type: 'submitError', error: 'Network failed' })
    expect(s.status).toBe('error')
    expect(s.submitError).toBe('Network failed')
  })

  it('reset returns to initial state', () => {
    const dirty: FormState = {
      status: 'error',
      touched: { email: true },
      submitError: 'boom',
    }
    const [s] = update(dirty, { type: 'reset' })
    expect(s).toEqual({ status: 'idle', touched: {}, submitError: null })
  })
})

// ── Connect tests ───────────────────────────────────────────────

describe('form.connect', () => {
  type Ctx = { form: FormState }

  it('returns root with aria-busy during submit', () => {
    const parts = connect<Ctx>((s) => s.form, vi.fn(), { id: 'f1' })
    expect(
      parts.root['aria-busy']({
        form: { status: 'submitting', touched: {}, submitError: null },
      }),
    ).toBe('true')
    expect(
      parts.root['aria-busy']({ form: { status: 'idle', touched: {}, submitError: null } }),
    ).toBeUndefined()
  })

  it('field returns touched accessor', () => {
    const parts = connect<Ctx>((s) => s.form, vi.fn(), { id: 'f1' })
    const field = parts.field('email')
    expect(
      field.touched({ form: { status: 'idle', touched: { email: true }, submitError: null } }),
    ).toBe(true)
    expect(field.touched({ form: { status: 'idle', touched: {}, submitError: null } })).toBe(false)
  })

  it('field onBlur sends touch', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.form, send, { id: 'f1' })
    parts.field('email').onBlur({} as FocusEvent)
    expect(send).toHaveBeenCalledWith({ type: 'touch', field: 'email' })
  })

  it('submit is disabled during submit', () => {
    const parts = connect<Ctx>((s) => s.form, vi.fn(), { id: 'f1' })
    expect(
      parts.submit.disabled({
        form: { status: 'submitting', touched: {}, submitError: null },
      }),
    ).toBe(true)
    expect(
      parts.submit.disabled({ form: { status: 'idle', touched: {}, submitError: null } }),
    ).toBe(false)
  })
})

// ── Standard Schema integration ────────────────────────────────

describe('validateSchema', () => {
  it('returns isValid true when schema passes', () => {
    const result = validateSchema(successSchema, {
      email: 'a@b.com',
      password: 'longenough',
      name: 'Alice',
    })
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual({})
    expect(result.issues).toEqual([])
  })

  it('collects first error per field from issues', () => {
    const result = validateSchema(failureSchema, {})
    expect(result.isValid).toBe(false)
    expect(result.errors.email).toBe('Invalid email')
    expect(result.errors.password).toBe('Password too short')
    expect(result.errors.name).toBe('Name required')
  })

  it('keeps all issues unaltered', () => {
    const result = validateSchema(failureSchema, {})
    expect(result.issues).toHaveLength(3)
    expect(result.issues[0]?.path).toEqual(['email'])
  })

  it('handles PathSegment objects', () => {
    const schemaWithSegmentPath = makeSchema(() => ({
      issues: [{ message: 'Bad', path: [{ key: 'email' }] }],
    }))
    const result = validateSchema(schemaWithSegmentPath, {})
    expect(result.errors.email).toBe('Bad')
  })

  it('skips issues with empty path', () => {
    const schemaWithRootIssue = makeSchema(() => ({
      issues: [{ message: 'Root error' }, { message: 'Field error', path: ['email'] }],
    }))
    const result = validateSchema(schemaWithRootIssue, {})
    expect(result.errors).toEqual({ email: 'Field error' })
  })

  it('only records first error per field (issue order wins)', () => {
    const dupeSchema = makeSchema(() => ({
      issues: [
        { message: 'First', path: ['email'] },
        { message: 'Second', path: ['email'] },
      ],
    }))
    const result = validateSchema(dupeSchema, {})
    expect(result.errors.email).toBe('First')
  })

  it('throws helpful error if schema is async', () => {
    expect(() => validateSchema(asyncSchema, {})).toThrow(/must be synchronous/)
  })
})

describe('validateSchemaAsync', () => {
  it('handles async schemas', async () => {
    const result = await validateSchemaAsync(asyncSchema, {})
    expect(result.isValid).toBe(true)
  })

  it('handles sync schemas too', async () => {
    const result = await validateSchemaAsync(successSchema, {})
    expect(result.isValid).toBe(true)
  })

  it('collects errors from async schemas', async () => {
    const failingAsync: StandardSchemaV1<Values> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () =>
          Promise.resolve({
            issues: [{ message: 'Invalid email', path: ['email'] }],
          }),
      },
    }
    const result = await validateSchemaAsync(failingAsync, {})
    expect(result.isValid).toBe(false)
    expect(result.errors.email).toBe('Invalid email')
  })
})
