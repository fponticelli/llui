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
} from '@llui/dom'
import type { View } from '@llui/dom'
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
  /** @intent("Set the value of a form field") */
  | { type: 'setField'; field: keyof State['values']; value: string }
  /** @intent("Submit the form") */
  | { type: 'submit' }
  /** @intent("Reset the form to its initial state") */
  | { type: 'reset' }
  /** @intent("Handle blur event on a form field") */
  | { type: 'fieldBlur'; field: string }

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
  view: (h) => {
    const { send, text, show } = h
    const formParts = form.connect<State>(
      (s) => s.form,
      (m) => send(m as never),
      { id: 'signup' },
    )

    // Compute current validation result for display
    const errors = (s: State): Partial<Record<keyof Values, string>> => {
      const result = validateSchema(SignupSchema, s.values)
      return result.errors
    }

    return [
      h1([text('Sign up')]),
      p({ class: 'subtitle' }, [
        text('Form validation powered by Zod + Standard Schema + @llui/components'),
      ]),

      ...show({
        when: (s) => s.form.status === 'submitted',
        render: (h) => [
          div({ class: 'success-banner' }, [h.text('✓ Account created successfully')]),
        ],
      }),

      formEl(
        {
          ...formParts.root,
          onSubmit: (e: Event) => {
            e.preventDefault()
            send({ type: 'submit' })
          },
        },
        [
          field(h, formParts, 'email', 'Email', 'email', errors),
          field(h, formParts, 'username', 'Username', 'text', errors),
          field(h, formParts, 'password', 'Password', 'password', errors),
          field(h, formParts, 'age', 'Age', 'number', errors),

          div({ class: 'actions' }, [
            button({ ...formParts.submit }, [text('Create account')]),
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
    ]
  },
})

// ── Field helper ────────────────────────────────────────────────

type FieldName = keyof State['values']

function field(
  h: View<State, Msg>,
  formParts: ReturnType<typeof form.connect<State>>,
  name: FieldName,
  labelText: string,
  inputType: string,
  errors: (s: State) => Partial<Record<keyof Values, string>>,
): HTMLElement {
  const { text, send } = h
  const fieldParts = formParts.field(name)

  // Show error only when touched AND has an error
  const errorMsg = (s: State): string => {
    if (!s.form.touched[name]) return ''
    return errors(s)[name as keyof Values] ?? ''
  }

  return div(
    {
      ...fieldParts,
      class: (s: State) => `field${errorMsg(s) ? ' has-error' : ''}`,
    },
    [
      label({ for: `field-${name}` }, [text(labelText)]),
      input({
        ...fieldParts,
        id: `field-${name}`,
        type: inputType,
        value: (s: State) => s.values[name],
        onInput: (e: Event) => {
          const target = e.currentTarget as HTMLInputElement
          send({ type: 'setField', field: name, value: target.value })
        },
        onBlur: () => send({ type: 'fieldBlur', field: name }),
        'aria-invalid': (s: State) => (errorMsg(s) ? 'true' : undefined),
        'aria-describedby': `error-${name}`,
      }),
      span({ id: `error-${name}`, class: 'field-error', role: 'alert' }, [text(errorMsg)]),
    ],
  )
}

// ── Mount ───────────────────────────────────────────────────────

mountApp(document.getElementById('app')!, App)
