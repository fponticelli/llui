import {
  component,
  mountApp,
  div,
  h1,
  p,
  form as formEl,
  label,
  input,
  button,
  span,
  pre,
  text,
  show,
  derived,
} from '@llui/dom'
import type { Signal, Send, Mountable } from '@llui/dom'
import { form, validateSchema } from '@llui/components'
import type { FormState } from '@llui/components'
import { z } from 'zod'

// ── Schema ──────────────────────────────────────────────────────
// Zod schema implements Standard Schema natively (v3.24+).
// validateSchema() works with any Standard Schema-compatible library.

const SignupSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers, and underscores only'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  age: z.coerce.number().int('Must be a whole number').min(13, 'Must be at least 13'),
})

type Values = z.infer<typeof SignupSchema>

// ── Types ───────────────────────────────────────────────────────

type State = {
  values: { email: string; username: string; password: string; age: string }
  form: FormState
}

type Msg =
  /**
   * @intent("Set the value of a form field")
   * @example({"type":"setField","field":"email","value":"alice@example.com"})
   */
  | { type: 'setField'; field: keyof State['values']; value: string }
  /** @intent("Submit the form") */
  | { type: 'submit' }
  /** @intent("Reset the form to its initial state") */
  | { type: 'reset' }
  /**
   * @intent("Mark a form field as touched after blur (for validation timing)")
   * @example({"type":"fieldBlur","field":"email"})
   */
  | { type: 'fieldBlur'; field: string }

// ── Validation helpers (pure) ───────────────────────────────────

type FieldName = keyof State['values']
type FieldValues = State['values']

function errorFor(values: FieldValues, touched: boolean, name: FieldName): string {
  if (!touched) return ''
  const result = validateSchema(SignupSchema, values)
  if (result.isValid) return ''
  return result.errors[name as keyof Values] ?? ''
}

// ── Component ───────────────────────────────────────────────────

const App = component<State, Msg, never>({
  name: 'SignupForm',
  init: () => [
    {
      values: { email: '', username: '', password: '', age: '' },
      form: form.init(),
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setField':
        return [{ ...state, values: { ...state.values, [msg.field]: msg.value } }, []]
      case 'fieldBlur':
        return [
          { ...state, form: form.update(state.form, { type: 'touch', field: msg.field })[0] },
          [],
        ]
      case 'submit': {
        // Validate via Zod schema
        const result = validateSchema(SignupSchema, state.values)
        if (!result.isValid) {
          // Mark all fields touched so errors show
          return [
            {
              ...state,
              form: form.update(state.form, {
                type: 'touchAll',
                fields: Object.keys(state.values),
              })[0],
            },
            [],
          ]
        }
        // Pretend to submit (in real app, this would be an HTTP effect)
        return [
          {
            ...state,
            form: form.update(state.form, { type: 'submitSuccess' })[0],
          },
          [],
        ]
      }
      case 'reset':
        return [
          {
            values: { email: '', username: '', password: '', age: '' },
            form: form.init(),
          },
          [],
        ]
    }
  },
  view: ({ state, send }) => [
    h1([text('Sign up')]),
    p({ class: 'subtitle' }, [
      text('Form validation powered by Zod + Standard Schema + @llui/components'),
    ]),

    show(
      state.at('form.status').map((status) => status === 'submitted'),
      () => [div({ class: 'success-banner' }, [text('✓ Account created successfully')])],
    ),

    formEl(
      {
        'data-scope': 'form',
        'data-part': 'root',
        'data-state': state.at('form.status'),
        'aria-busy': state.at('form.status').map((status) => status === 'submitting'),
        onSubmit: (e: Event) => {
          e.preventDefault()
          send({ type: 'submit' })
        },
      },
      [
        field(state.at('values'), state.at('form.touched'), send, 'email', 'Email', 'email'),
        field(state.at('values'), state.at('form.touched'), send, 'username', 'Username', 'text'),
        field(
          state.at('values'),
          state.at('form.touched'),
          send,
          'password',
          'Password',
          'password',
        ),
        field(state.at('values'), state.at('form.touched'), send, 'age', 'Age', 'number'),

        div({ class: 'actions' }, [
          button(
            {
              type: 'submit',
              'data-scope': 'form',
              'data-part': 'submit',
              'data-state': state.at('form.status'),
              disabled: state.at('form.status').map((status) => status === 'submitting'),
            },
            [text('Create account')],
          ),
          button(
            {
              type: 'button',
              class: 'secondary',
              onClick: () => send({ type: 'reset' }),
            },
            [text('Reset')],
          ),
        ]),
      ],
    ),

    pre({ class: 'schema-block' }, [
      text(`const schema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  age: z.coerce.number().int().min(13),
})

const result = validateSchema(schema, values)
// → { isValid, errors: { email: '...' }, issues: [...] }`),
    ]),
  ],
})

// ── Field helper ────────────────────────────────────────────────

function field(
  values: Signal<FieldValues>,
  touched: Signal<Record<string, boolean>>,
  send: Send<Msg>,
  name: FieldName,
  labelText: string,
  inputType: string,
): Mountable {
  const fieldTouched = touched.at(name).map(Boolean)
  const error = derived([values, fieldTouched], (vals, isTouched) =>
    errorFor(vals, isTouched, name),
  )

  return div(
    {
      'data-scope': 'form',
      'data-part': 'field',
      'data-touched': fieldTouched.map((t) => (t ? '' : null)),
      class: error.map((msg) => `field${msg ? ' has-error' : ''}`),
    },
    [
      label({ for: `field-${name}` }, [text(labelText)]),
      input({
        id: `field-${name}`,
        type: inputType,
        value: values.at(name),
        onInput: (e: Event) => {
          const target = e.currentTarget as HTMLInputElement
          send({ type: 'setField', field: name, value: target.value })
        },
        onBlur: () => send({ type: 'fieldBlur', field: name }),
        'aria-invalid': error.map((msg) => (msg ? 'true' : null)),
        'aria-describedby': `error-${name}`,
      }),
      span({ id: `error-${name}`, class: 'field-error', role: 'alert' }, [text(error)]),
    ],
  )
}

// ── Mount ───────────────────────────────────────────────────────

mountApp(document.getElementById('app')!, App)
