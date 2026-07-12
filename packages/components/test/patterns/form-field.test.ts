import { describe, it, expect, vi } from 'vitest'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { init, update, connect } from '../../src/patterns/form-field'
import type { FormFieldState } from '../../src/patterns/form-field'
import { rootSignal, read } from '../_signal'

// ── Test schemas ────────────────────────────────────────────────
// Mock Standard Schema implementations — avoids requiring Zod/Valibot
// in the test suite. Real apps bring their own validation library.

type Values = { email: string; password: string }

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

const failureSchema = makeSchema(
  () =>
    ({
      issues: [
        { message: 'Invalid email', path: ['email'] },
        { message: 'Password too short', path: ['password'] },
      ],
    }) as StandardSchemaV1.Result<Values>,
)

const successSchema = makeSchema(
  () =>
    ({ value: { email: 'a@b.com', password: 'longenough' } }) as StandardSchemaV1.Result<Values>,
)

const asyncFailureSchema: StandardSchemaV1<Values> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () =>
      Promise.resolve({
        issues: [{ message: 'Email taken', path: ['email'] }],
      }),
  },
}

const asyncSuccessSchema: StandardSchemaV1<Values> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => Promise.resolve({ value: { email: 'a@b.com', password: 'longenough' } }),
  },
}

// nested + array path schema
type Nested = { address: { street: string }; tags: string[] }
const nestedSchema: StandardSchemaV1<Nested> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () =>
      ({
        issues: [
          { message: 'Street required', path: ['address', 'street'] },
          { message: 'Tag required', path: ['tags', 0] },
        ],
      }) as StandardSchemaV1.Result<Nested>,
  },
}

// ── Reducer tests ───────────────────────────────────────────────

describe('formField reducer', () => {
  it('initializes idle with per-field slices', () => {
    const s = init({ id: 'signup', fields: ['email', 'password'] })
    expect(s.form.status).toBe('idle')
    expect(s.form.touched).toEqual({})
    expect(s.issues).toEqual([])
    expect(s.fields.email!.invalid).toBe(false)
    expect(s.fields.password!.invalid).toBe(false)
    // field slice ids derive from the form id + field name
    expect(s.fields.email!.id).toBe('signup:email')
  })

  it('validate (sync) sets invalid on each errored field + stores issues', () => {
    const s0 = init({ id: 'signup', fields: ['email', 'password'] })
    const [s] = update(s0, { type: 'validate', schema: failureSchema, values: {} })
    expect(s.fields.email!.invalid).toBe(true)
    expect(s.fields.password!.invalid).toBe(true)
    expect(s.issues).toHaveLength(2)
  })

  it('validate clears invalid for fields that now pass', () => {
    const s0 = init({ id: 'signup', fields: ['email', 'password'] })
    const [bad] = update(s0, { type: 'validate', schema: failureSchema, values: {} })
    expect(bad.fields.email!.invalid).toBe(true)
    const [good] = update(bad, { type: 'validate', schema: successSchema, values: {} })
    expect(good.fields.email!.invalid).toBe(false)
    expect(good.fields.password!.invalid).toBe(false)
    expect(good.issues).toEqual([])
  })

  it('validate maps nested + array index paths to field names', () => {
    const s0 = init({ id: 'profile', fields: ['address.street', 'tags.0'] })
    const [s] = update(s0, { type: 'validate', schema: nestedSchema, values: {} })
    expect(s.fields['address.street']!.invalid).toBe(true)
    expect(s.fields['tags.0']!.invalid).toBe(true)
  })

  it('touch marks a field touched', () => {
    const s0 = init({ id: 'signup', fields: ['email'] })
    const [s] = update(s0, { type: 'touch', field: 'email' })
    expect(s.form.touched.email).toBe(true)
  })

  it('submit transitions form to submitting', () => {
    const s0 = init({ id: 'signup', fields: ['email'] })
    const [s] = update(s0, { type: 'submit' })
    expect(s.form.status).toBe('submitting')
  })

  it('submitSuccess marks submitted', () => {
    const s0 = init({ id: 'signup', fields: ['email'] })
    const [submitting] = update(s0, { type: 'submit' })
    const [s] = update(submitting, { type: 'submitSuccess' })
    expect(s.form.status).toBe('submitted')
  })

  it('validateAsync sets pending then resolves invalid via validateResult', async () => {
    const s0 = init({ id: 'signup', fields: ['email', 'password'] })
    const [pending, fx] = update(s0, {
      type: 'validateAsync',
      schema: asyncFailureSchema,
      values: {},
    })
    expect(pending.fields.email!.pending).toBe(true)
    expect(fx).toEqual([])
    // resolve the promise produced internally and feed result back
    const result = await asyncFailureSchema['~standard'].validate({})
    const issues = 'issues' in result && result.issues ? result.issues : []
    const [resolved] = update(pending, { type: 'validateResult', issues: [...issues] })
    expect(resolved.fields.email!.pending).toBe(false)
    expect(resolved.fields.email!.invalid).toBe(true)
  })

  it('validateResult on success clears pending + invalid', async () => {
    const s0 = init({ id: 'signup', fields: ['email'] })
    const [pending] = update(s0, {
      type: 'validateAsync',
      schema: asyncSuccessSchema,
      values: {},
    })
    const result = await asyncSuccessSchema['~standard'].validate({})
    const issues = 'issues' in result && result.issues ? result.issues : []
    const [resolved] = update(pending, { type: 'validateResult', issues: [...issues] })
    expect(resolved.fields.email!.pending).toBe(false)
    expect(resolved.fields.email!.invalid).toBe(false)
  })
})

// ── connect tests ───────────────────────────────────────────────

const stateOf = (over: Partial<FormFieldState> = {}): FormFieldState => {
  const base = init({ id: 'signup', fields: ['email', 'password'] })
  return { ...base, ...over }
}

describe('formField connect — formField(name) part bag', () => {
  it('yields field ids derived from form id + name', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), { id: 'signup', fields: ['email'] })
    const f = p.formField('email')
    expect(f.label.htmlFor).toBe('signup:email:control')
    expect(f.control.id).toBe('signup:email:control')
    expect(f.label.id).toBe('signup:email:label')
    expect(f.errorText.id).toBe('signup:email:error')
  })

  it('control carries aria-describedby + the form blur-to-touch handler', () => {
    const send = vi.fn()
    const p = connect(rootSignal<FormFieldState>(), send, { id: 'signup', fields: ['email'] })
    const f = p.formField('email')
    expect(typeof f.control.onBlur).toBe('function')
    f.control.onBlur({} as FocusEvent)
    // the merged blur handler touches the field through the pattern
    expect(send).toHaveBeenCalledWith({ type: 'touch', field: 'email' })
  })

  it('aria-invalid only shows when touched OR submitted (touch gating)', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), { id: 'signup', fields: ['email'] })
    const f = p.formField('email')

    const invalidUntouched = stateOf()
    invalidUntouched.fields.email!.invalid = true
    // invalid but not touched, status idle → hidden
    expect(read(f.control['aria-invalid'], invalidUntouched)).toBeUndefined()

    const invalidTouched = stateOf()
    invalidTouched.fields.email!.invalid = true
    invalidTouched.form.touched.email = true
    expect(read(f.control['aria-invalid'], invalidTouched)).toBe('true')

    const invalidSubmitted = stateOf()
    invalidSubmitted.fields.email!.invalid = true
    invalidSubmitted.form.status = 'submitted'
    expect(read(f.control['aria-invalid'], invalidSubmitted)).toBe('true')
  })

  it('aria-describedby adds the error id only when error is visible', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), {
      id: 'signup',
      fields: ['email'],
    })
    const f = p.formField('email', { hasDescription: true })

    const hidden = stateOf()
    hidden.fields.email!.invalid = true
    expect(read(f.control['aria-describedby'], hidden)).toBe('signup:email:description')

    const shown = stateOf()
    shown.fields.email!.invalid = true
    shown.form.touched.email = true
    expect(read(f.control['aria-describedby'], shown)).toBe(
      'signup:email:description signup:email:error',
    )
  })

  it('errorText.message renders first issue for the field, visible only when gated', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), { id: 'signup', fields: ['email'] })
    const f = p.formField('email')

    const withIssue = stateOf({
      issues: [{ message: 'Invalid email', path: ['email'] }],
    })
    withIssue.fields.email!.invalid = true
    // not touched → no visible message
    expect(read(f.errorVisible, withIssue)).toBe(false)
    expect(read(f.errorText.message, withIssue)).toBe('')

    withIssue.form.touched.email = true
    expect(read(f.errorVisible, withIssue)).toBe(true)
    expect(read(f.errorText.message, withIssue)).toBe('Invalid email')
  })

  it('errorText exposes all issues for the field for custom rendering', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), { id: 'signup', fields: ['email'] })
    const f = p.formField('email')
    const st = stateOf({
      issues: [
        { message: 'Invalid email', path: ['email'] },
        { message: 'Email taken', path: ['email'] },
        { message: 'Other', path: ['password'] },
      ],
    })
    st.fields.email!.invalid = true
    st.form.touched.email = true
    const all = read(f.errorText.issues, st)
    expect(all.map((i) => i.message)).toEqual(['Invalid email', 'Email taken'])
  })

  it('pending exposes async-validation state on the control', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), { id: 'signup', fields: ['email'] })
    const f = p.formField('email')
    const pendingState = stateOf()
    pendingState.fields.email!.pending = true
    expect(read(f.control['aria-busy'], pendingState)).toBe('true')
    expect(read(f.control['aria-busy'], stateOf())).toBeUndefined()
  })

  it('root reflects form status', () => {
    const p = connect(rootSignal<FormFieldState>(), vi.fn(), { id: 'signup', fields: ['email'] })
    expect(read(p.root['data-state'], stateOf())).toBe('idle')
  })
})
