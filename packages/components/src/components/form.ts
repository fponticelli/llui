import type { Send } from '@llui/dom'
import type { StandardSchemaV1 } from '@standard-schema/spec'

/**
 * Form — submit lifecycle + touched tracking + Standard Schema validation.
 *
 * Values live in the parent component's state; `form` tracks submit status
 * and which fields have been interacted with (blur), so errors are shown
 * only after touch instead of immediately.
 *
 * Bring your own validation library — any Standard Schema-compatible
 * schema works (Zod, Valibot, ArkType, etc.). See https://standardschema.dev.
 *
 * ```ts
 * import { z } from 'zod'
 * import { form, validateSchema } from '@llui/components/form'
 *
 * const schema = z.object({
 *   email: z.string().email(),
 *   password: z.string().min(8),
 * })
 *
 * type Values = z.infer<typeof schema>
 * type State = { values: Values; form: FormState }
 *
 * update: (state, msg) => {
 *   switch (msg.type) {
 *     case 'submit': {
 *       const result = validateSchema(schema, state.values)
 *       if (!result.isValid) {
 *         return [{ ...state, form: { ...state.form, touched: { email: true, password: true } } }, []]
 *       }
 *       return [{ ...state, form: { ...state.form, status: 'submitting' } }, [saveUserEffect]]
 *     }
 *   }
 * }
 * ```
 */

export type FormStatus = 'idle' | 'submitting' | 'submitted' | 'error'

export interface FormState {
  status: FormStatus
  touched: Record<string, boolean>
  submitError: string | null
}

export type FormMsg =
  /** @intent("Touch") */
  | { type: 'touch'; field: string }
  /** @intent("Touch All") */
  | { type: 'touchAll'; fields: string[] }
  /** @intent("Submit") */
  | { type: 'submit' }
  /** @intent("Submit Success") */
  | { type: 'submitSuccess' }
  /** @intent("Submit Error") */
  | { type: 'submitError'; error: string }
  /** @intent("Reset") */
  | { type: 'reset' }

export function init(): FormState {
  return { status: 'idle', touched: {}, submitError: null }
}

export function update(state: FormState, msg: FormMsg): [FormState, never[]] {
  switch (msg.type) {
    case 'touch':
      if (state.touched[msg.field]) return [state, []]
      return [{ ...state, touched: { ...state.touched, [msg.field]: true } }, []]
    case 'touchAll': {
      const touched = { ...state.touched }
      for (const f of msg.fields) touched[f] = true
      return [{ ...state, touched }, []]
    }
    case 'submit':
      return [{ ...state, status: 'submitting', submitError: null }, []]
    case 'submitSuccess':
      return [{ ...state, status: 'submitted', submitError: null }, []]
    case 'submitError':
      return [{ ...state, status: 'error', submitError: msg.error }, []]
    case 'reset':
      return [init(), []]
  }
}

export interface FormParts<S> {
  root: {
    'data-scope': 'form'
    'data-part': 'root'
    'data-state': (s: S) => FormStatus
    'aria-busy': (s: S) => 'true' | undefined
  }
  field: (name: string) => {
    'data-scope': 'form'
    'data-part': 'field'
    'data-touched': (s: S) => '' | undefined
    touched: (s: S) => boolean
    onBlur: (e: FocusEvent) => void
  }
  submit: {
    type: 'submit'
    'data-scope': 'form'
    'data-part': 'submit'
    'data-state': (s: S) => FormStatus
    disabled: (s: S) => boolean
  }
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => FormState,
  send: Send<FormMsg>,
  _opts: ConnectOptions,
): FormParts<S> {
  return {
    root: {
      'data-scope': 'form',
      'data-part': 'root',
      'data-state': (s) => get(s).status,
      'aria-busy': (s) => (get(s).status === 'submitting' ? 'true' : undefined),
    },
    field: (name) => ({
      'data-scope': 'form',
      'data-part': 'field',
      'data-touched': (s) => (get(s).touched[name] ? '' : undefined),
      touched: (s) => !!get(s).touched[name],
      onBlur: () => send({ type: 'touch', field: name }),
    }),
    submit: {
      type: 'submit',
      'data-scope': 'form',
      'data-part': 'submit',
      'data-state': (s) => get(s).status,
      disabled: (s) => get(s).status === 'submitting',
    },
  }
}

// ── Standard Schema integration ────────────────────────────────

export interface ValidateResult<T> {
  isValid: boolean
  /** Field name → first error message. Field name is derived from the issue's path. */
  errors: Partial<Record<keyof T, string>>
  /** All issues from the schema validator, unaltered. */
  issues: readonly StandardSchemaV1.Issue[]
}

/**
 * Run a Standard Schema synchronously against a values object. Throws if
 * the schema returns a Promise — use sync validation only for form submit.
 *
 * Works with any library implementing the Standard Schema spec:
 * Zod (v3.24+), Valibot (v1+), ArkType, etc.
 */
export function validateSchema<T>(schema: StandardSchemaV1<T>, values: unknown): ValidateResult<T> {
  const result = schema['~standard'].validate(values)
  if (result instanceof Promise) {
    throw new Error(
      '[@llui/components/form] validateSchema: schema returned a Promise. ' +
        'Form validation must be synchronous. Use `validateSchemaAsync` for async schemas.',
    )
  }

  if (!result.issues) {
    return { isValid: true, errors: {}, issues: [] }
  }

  const errors: Partial<Record<keyof T, string>> = {}
  for (const issue of result.issues) {
    const path = issue.path
    if (!path || path.length === 0) continue
    const first = path[0]
    const key = (typeof first === 'object' ? first.key : first) as keyof T
    // Only record the first error per field
    if (errors[key] === undefined) {
      errors[key] = issue.message
    }
  }

  return { isValid: false, errors, issues: result.issues }
}

/**
 * Async variant — returns a Promise. Use when the schema performs async
 * validation (e.g. uniqueness checks against a backend).
 */
export async function validateSchemaAsync<T>(
  schema: StandardSchemaV1<T>,
  values: unknown,
): Promise<ValidateResult<T>> {
  const result = await schema['~standard'].validate(values)

  if (!result.issues) {
    return { isValid: true, errors: {}, issues: [] }
  }

  const errors: Partial<Record<keyof T, string>> = {}
  for (const issue of result.issues) {
    const path = issue.path
    if (!path || path.length === 0) continue
    const first = path[0]
    const key = (typeof first === 'object' ? first.key : first) as keyof T
    if (errors[key] === undefined) {
      errors[key] = issue.message
    }
  }

  return { isValid: false, errors, issues: result.issues }
}

export const form = { init, update, connect, validateSchema, validateSchemaAsync }
