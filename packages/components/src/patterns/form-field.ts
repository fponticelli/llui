import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  init as fieldInit,
  type FieldState,
  type FieldConnectOptions,
} from '../components/field.js'
import {
  init as formInit,
  validateSchema,
  validateSchemaAsync,
  type FormState,
  type FormStatus,
} from '../components/form.js'

/**
 * FormField — field ARIA wiring + form touched-tracking + schema error
 * display, pre-wired into a single composed pattern.
 *
 * Builds on the `field` component (per-control id/aria wiring) and the `form`
 * component (submit lifecycle + touched tracking + Standard Schema validation).
 * The consumer holds ONE composed slice; a `validate` / `validateAsync` message
 * runs a Standard Schema, maps issue PATHS to field names (including nested
 * paths like `address.street` and array indices like `tags.0`), and flips each
 * field's `invalid`. The error VISIBILITY rule is baked in: a field's error is
 * shown only when `touched[name] || status === 'submitted'`.
 *
 * Usage:
 *
 * ```ts
 * import { z } from 'zod'
 * const schema = z.object({ email: z.string().email() })
 *
 * type State = { values: { email: string }; ff: FormFieldState }
 *
 * init: () => [{ values: { email: '' }, ff: formField.init({ id: 'signup', fields: ['email'] }) }, []]
 *
 * update: (state, msg) => {
 *   switch (msg.type) {
 *     case 'ff': {
 *       const [ff, fx] = formField.update(state.ff, msg.msg)
 *       return [{ ...state, ff }, fx]
 *     }
 *     case 'submit': {
 *       const [ff] = formField.update(state.ff, { type: 'validate', schema, values: state.values })
 *       return [{ ...state, ff }, []]
 *     }
 *   }
 * }
 *
 * view: ({ state, send }) => {
 *   const ff = state.at('ff')
 *   const p = formField.connect(ff, m => send({ type: 'ff', msg: m }), { id: 'signup', fields: ['email'] })
 *   const email = p.formField('email', { hasDescription: true })
 *   return [
 *     el('div', email.root, [
 *       el('label', email.label, [text('Email')]),
 *       el('input', { ...email.control, type: 'email' }),
 *       show(email.errorVisible, () => el('p', email.errorText, [text(email.errorText.message)])),
 *     ]),
 *   ]
 * }
 * ```
 */

/** Per-field slice: the `field` component's state plus an async-validation flag. */
export interface FormFieldSlice extends FieldState {
  /** True while an async validation for this field is in flight. */
  pending: boolean
}

export interface FormFieldState {
  /** The composed `form` lifecycle slice (status, touched, submitError). */
  form: FormState
  /** Per-field slices keyed by field name. */
  fields: Record<string, FormFieldSlice>
  /** The issues from the last validation, unaltered. */
  issues: StandardSchemaV1.Issue[]
}

export type FormFieldMsg =
  /** @intent("Validate the given values against a Standard Schema synchronously and update field validity") */
  | { type: 'validate'; schema: StandardSchemaV1<unknown>; values: unknown }
  /** @intent("Begin an async validation — marks every field pending until validateResult arrives") */
  | { type: 'validateAsync'; schema: StandardSchemaV1<unknown>; values: unknown }
  /** @intent("Apply the issues from a resolved async validation, clearing the pending state") */
  | { type: 'validateResult'; issues: StandardSchemaV1.Issue[] }
  /** @intent("Mark a single field as touched (typically on blur)") */
  | { type: 'touch'; field: string }
  /** @intent("Mark every field as touched (typically on a failed submit attempt)") */
  | { type: 'touchAll' }
  /** @intent("Begin form submission — transitions status to submitting") */
  | { type: 'submit' }
  /** @intent("Mark the in-flight submission as successful") */
  | { type: 'submitSuccess' }
  /** @intent("Mark the in-flight submission as failed with the given error message") */
  | { type: 'submitError'; error: string }
  /** @intent("Reset the form and every field slice to their initial state") */
  | { type: 'reset' }

export interface FormFieldInit {
  /** Base id; field slice ids derive as `${id}:${name}`. */
  id: string
  /** The field names this form manages. */
  fields: readonly string[]
}

function initSlices(opts: FormFieldInit): Record<string, FormFieldSlice> {
  const fields: Record<string, FormFieldSlice> = {}
  for (const name of opts.fields) {
    fields[name] = { ...fieldInit({ id: `${opts.id}:${name}` }), pending: false }
  }
  return fields
}

export function init(opts: FormFieldInit): FormFieldState {
  return {
    form: formInit(),
    fields: initSlices(opts),
    issues: [],
  }
}

/**
 * Map a Standard Schema issue path to a flat field name. Object keys join with
 * `.` and array indices append as `.<n>` — so `['address', 'street']` becomes
 * `address.street` and `['tags', 0]` becomes `tags.0`. These match the keys a
 * consumer passes in `fields`.
 */
export function pathToFieldName(path: StandardSchemaV1.Issue['path']): string {
  if (!path) return ''
  const parts: string[] = []
  for (const seg of path) {
    const key = typeof seg === 'object' && seg !== null ? seg.key : seg
    parts.push(String(key))
  }
  return parts.join('.')
}

/** Apply a set of issues onto the field slices: a field is invalid iff at least
 * one issue maps to its name. `pending` is cleared on every applied field. */
function applyIssues(
  fields: Record<string, FormFieldSlice>,
  issues: readonly StandardSchemaV1.Issue[],
): Record<string, FormFieldSlice> {
  const invalidNames = new Set<string>()
  for (const issue of issues) {
    const name = pathToFieldName(issue.path)
    if (name) invalidNames.add(name)
  }
  const next: Record<string, FormFieldSlice> = {}
  for (const name of Object.keys(fields)) {
    const slice = fields[name]
    next[name] = { ...slice, invalid: invalidNames.has(name), pending: false }
  }
  return next
}

export function update(state: FormFieldState, msg: FormFieldMsg): [FormFieldState, never[]] {
  switch (msg.type) {
    case 'validate': {
      const result = validateSchema(msg.schema, msg.values)
      const issues = [...result.issues]
      return [{ ...state, issues, fields: applyIssues(state.fields, issues) }, []]
    }
    case 'validateAsync': {
      // Mark every field pending; the consumer kicks off the async validation
      // (via validateSchemaAsync) and dispatches `validateResult` when it
      // resolves. We do not run the promise here — effects-as-data keeps the
      // reducer pure and JSON-serializable.
      const fields: Record<string, FormFieldSlice> = {}
      for (const name of Object.keys(state.fields)) {
        fields[name] = { ...state.fields[name], pending: true }
      }
      return [{ ...state, fields }, []]
    }
    case 'validateResult':
      return [
        { ...state, issues: [...msg.issues], fields: applyIssues(state.fields, msg.issues) },
        [],
      ]
    case 'touch': {
      if (state.form.touched[msg.field]) return [state, []]
      return [
        {
          ...state,
          form: { ...state.form, touched: { ...state.form.touched, [msg.field]: true } },
        },
        [],
      ]
    }
    case 'touchAll': {
      const touched = { ...state.form.touched }
      for (const name of Object.keys(state.fields)) touched[name] = true
      return [{ ...state, form: { ...state.form, touched } }, []]
    }
    case 'submit':
      return [{ ...state, form: { ...state.form, status: 'submitting', submitError: null } }, []]
    case 'submitSuccess':
      return [{ ...state, form: { ...state.form, status: 'submitted', submitError: null } }, []]
    case 'submitError':
      return [{ ...state, form: { ...state.form, status: 'error', submitError: msg.error } }, []]
    case 'reset': {
      const fields: Record<string, FormFieldSlice> = {}
      for (const name of Object.keys(state.fields)) {
        fields[name] = { ...fieldInit({ id: state.fields[name].id }), pending: false }
      }
      return [{ form: formInit(), fields, issues: [] }, []]
    }
  }
}

// ── connect ──────────────────────────────────────────────────────

/** The composed part bag for a single field. */
export interface FormFieldFieldParts {
  root: {
    'data-scope': 'form-field'
    'data-part': 'field'
    'data-invalid': Signal<'' | undefined>
    'data-touched': Signal<'' | undefined>
  }
  label: {
    id: string
    htmlFor: string
    'data-scope': 'form-field'
    'data-part': 'label'
  }
  control: {
    id: string
    'aria-labelledby': string
    'aria-describedby': Signal<string | undefined>
    'aria-invalid': Signal<'true' | undefined>
    'aria-required': Signal<'true' | undefined>
    'aria-busy': Signal<'true' | undefined>
    disabled: Signal<boolean>
    readOnly: Signal<boolean>
    'data-scope': 'form-field'
    'data-part': 'control'
    onBlur: (e: FocusEvent) => void
  }
  description: {
    id: string
    'data-scope': 'form-field'
    'data-part': 'description'
  }
  errorText: {
    id: string
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'form-field'
    'data-part': 'error'
    /** First visible issue message for this field, or '' when no error is shown. */
    message: Signal<string>
    /** Every issue mapped to this field (for custom rendering). */
    issues: Signal<StandardSchemaV1.Issue[]>
  }
  /** True only when the field is invalid AND its error should be visible
   * (`touched || status === 'submitted'`). Use to gate `show(...)`. */
  errorVisible: Signal<boolean>
}

export interface FormFieldParts {
  root: {
    'data-scope': 'form-field'
    'data-part': 'root'
    'data-state': Signal<FormStatus>
    'aria-busy': Signal<'true' | undefined>
  }
  submit: {
    type: 'submit'
    'data-scope': 'form-field'
    'data-part': 'submit'
    'data-state': Signal<FormStatus>
    disabled: Signal<boolean>
  }
  /** Build the full part bag for the named field, with the form blur-to-touch
   * handler already merged into `control`. */
  formField: (name: string, opts?: FieldConnectOptions) => FormFieldFieldParts
}

export interface FormFieldConnectOptions {
  /** Base id; field slice ids derive as `${id}:${name}`. */
  id: string
  /** The field names this form manages. */
  fields: readonly string[]
}

/** Whether a field's error should be visible: touched OR the form was submitted. */
function isErrorVisible(state: FormFieldState, name: string): boolean {
  return !!state.form.touched[name] || state.form.status === 'submitted'
}

function issuesForField(state: FormFieldState, name: string): StandardSchemaV1.Issue[] {
  return state.issues.filter((issue) => pathToFieldName(issue.path) === name)
}

export function connect(
  state: Signal<FormFieldState>,
  send: Send<FormFieldMsg>,
  opts: FormFieldConnectOptions,
): FormFieldParts {
  return {
    root: {
      'data-scope': 'form-field',
      'data-part': 'root',
      'data-state': state.map((s) => s.form.status),
      'aria-busy': state.map((s) => (s.form.status === 'submitting' ? 'true' : undefined)),
    },
    submit: {
      type: 'submit',
      'data-scope': 'form-field',
      'data-part': 'submit',
      'data-state': state.map((s) => s.form.status),
      disabled: state.map((s) => s.form.status === 'submitting'),
    },
    formField: (name, fopts = {}) => {
      const base = `${opts.id}:${name}`
      const controlId = `${base}:control`
      const labelId = `${base}:label`
      const descriptionId = `${base}:description`
      const errorId = `${base}:error`
      const hasDescription = fopts.hasDescription ?? false

      return {
        root: {
          'data-scope': 'form-field',
          'data-part': 'field',
          'data-invalid': state.map((s) =>
            s.fields[name]?.invalid && isErrorVisible(s, name) ? '' : undefined,
          ),
          'data-touched': state.map((s) => (s.form.touched[name] ? '' : undefined)),
        },
        label: {
          id: labelId,
          htmlFor: controlId,
          'data-scope': 'form-field',
          'data-part': 'label',
        },
        control: {
          id: controlId,
          'aria-labelledby': labelId,
          'aria-describedby': state.map((s) => {
            const ids: string[] = []
            if (hasDescription) ids.push(descriptionId)
            if (s.fields[name]?.invalid && isErrorVisible(s, name)) ids.push(errorId)
            return ids.length > 0 ? ids.join(' ') : undefined
          }),
          'aria-invalid': state.map((s) =>
            s.fields[name]?.invalid && isErrorVisible(s, name) ? 'true' : undefined,
          ),
          'aria-required': state.map((s) => (s.fields[name]?.required ? 'true' : undefined)),
          'aria-busy': state.map((s) => (s.fields[name]?.pending ? 'true' : undefined)),
          disabled: state.map((s) => !!s.fields[name]?.disabled),
          readOnly: state.map((s) => !!s.fields[name]?.readonly),
          'data-scope': 'form-field',
          'data-part': 'control',
          onBlur: tagSend(send, ['touch'], () => send({ type: 'touch', field: name })),
        },
        description: {
          id: descriptionId,
          'data-scope': 'form-field',
          'data-part': 'description',
        },
        errorText: {
          id: errorId,
          role: 'alert',
          'aria-live': 'polite',
          'data-scope': 'form-field',
          'data-part': 'error',
          message: state.map((s) => {
            if (!isErrorVisible(s, name)) return ''
            const first = issuesForField(s, name)[0]
            return first ? first.message : ''
          }),
          issues: state.map((s) => issuesForField(s, name)),
        },
        errorVisible: state.map((s) => !!s.fields[name]?.invalid && isErrorVisible(s, name)),
      }
    },
  }
}

export const formField = { init, update, connect, validateSchema, validateSchemaAsync }
