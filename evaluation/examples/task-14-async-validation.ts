/**
 * Task 14 — Async Validation (Tier 3)
 * Idiomatic score: 6/6
 */
import { component, div, button, input, label, text, show, branch } from '@llui/dom'
import { handleEffects, http, cancel, debounce, type Effect } from '@llui/effects'

type ValidationStatus = 'idle' | 'checking' | 'available' | 'taken'

type State = {
  email: string
  status: ValidationStatus
}

type Msg =
  | { type: 'setEmail'; value: string }
  | { type: 'checkResult'; payload: { available: boolean } }
  | { type: 'checkError'; error: unknown }
  | { type: 'submit' }

// Effect is the built-in union from @llui/effects (imported above).

export const AsyncValidation = component<State, Msg, Effect>({
  name: 'AsyncValidation',
  init: () => [{ email: '', status: 'idle' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setEmail': {
        const email = msg.value
        if (email.trim() === '' || !email.includes('@')) {
          return [{ ...state, email, status: 'idle' }, [cancel('email-check')]]
        }
        return [
          { ...state, email, status: 'checking' },
          [
            cancel(
              'email-check',
              debounce(
                'email-check',
                500,
                http({
                  url: `/api/check-email?email=${encodeURIComponent(email)}`,
                  onSuccess: (data) => ({
                    type: 'checkResult' as const,
                    payload: data as { available: boolean },
                  }),
                  onError: (err) => ({ type: 'checkError' as const, error: err }),
                }),
              ),
            ),
          ],
        ]
      }
      case 'checkResult':
        return [
          {
            ...state,
            status: msg.payload.available ? 'available' : 'taken',
          },
          [],
        ]
      case 'checkError':
        return [{ ...state, status: 'idle' }, []]
      case 'submit':
        return [state, []]
    }
  },
  view: ({ send, branch }) => [
    div({ class: 'async-validation' }, [
      label([text('Email')]),
      input({
        type: 'email',
        value: (s: State) => s.email,
        onInput: (e: Event) =>
          send({ type: 'setEmail', value: (e.target as HTMLInputElement).value }),
      }),
      ...branch({
        on: (s) => s.status,
        cases: {
          idle: () => [],
          checking: () => [div({ class: 'status checking' }, [text('checking...')])],
          available: () => [div({ class: 'status available' }, [text('available')])],
          taken: () => [div({ class: 'status taken' }, [text('taken')])],
        },
      }),
      button(
        {
          class: 'submit-btn',
          onClick: () => send({ type: 'submit' }),
          disabled: (s: State) => s.status !== 'available',
        },
        [text('Submit')],
      ),
    ]),
  ],
  onEffect: handleEffects<Effect>().else(() => {
    // No custom effects
  }),
})
