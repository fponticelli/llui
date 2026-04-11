/**
 * Task 07 — Multi-Step Form (Tier 2)
 * Idiomatic score: 6/6
 */
import { component, div, button, input, label } from '@llui/dom'
import { applyField, type FieldMsg } from '@llui/dom'

type Fields = {
  name: string
  email: string
  summary: string
}

type State = Fields & {
  step: 1 | 2 | 3 | 4
}

type Msg = FieldMsg<Fields> | { type: 'next' } | { type: 'back' } | { type: 'submit' }

type Effect = never

const isStepValid = (state: State): boolean => {
  switch (state.step) {
    case 1:
      return state.name.trim() !== ''
    case 2:
      return state.email.trim() !== '' && state.email.includes('@')
    case 3:
      return state.summary.trim() !== ''
    case 4:
      return true
  }
}

export const MultiStepForm = component<State, Msg, Effect>({
  name: 'MultiStepForm',
  init: () => [{ step: 1, name: '', email: '', summary: '' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setField':
        return [applyField(state, msg.field, msg.value), []]
      case 'next':
        if (!isStepValid(state) || state.step >= 4) return [state, []]
        return [{ ...state, step: (state.step + 1) as State['step'] }, []]
      case 'back':
        if (state.step <= 1) return [state, []]
        return [{ ...state, step: (state.step - 1) as State['step'] }, []]
      case 'submit':
        return [state, []]
    }
  },
  view: ({ send, text, branch }) => [
    div({ class: 'multi-step-form' }, [
      div({ class: 'step-indicator' }, [text((s) => `Step ${s.step} of 4`)]),
      ...branch({
        on: (s) => s.step,
        cases: {
          1: () => [
            div({ class: 'step' }, [
              label([text('Name')]),
              input({
                type: 'text',
                value: (s: State) => s.name,
                onInput: (e: Event) =>
                  send({
                    type: 'setField',
                    field: 'name',
                    value: (e.target as HTMLInputElement).value,
                  }),
              }),
            ]),
          ],
          2: () => [
            div({ class: 'step' }, [
              label([text('Email')]),
              input({
                type: 'email',
                value: (s: State) => s.email,
                onInput: (e: Event) =>
                  send({
                    type: 'setField',
                    field: 'email',
                    value: (e.target as HTMLInputElement).value,
                  }),
              }),
            ]),
          ],
          3: () => [
            div({ class: 'step' }, [
              label([text('Summary')]),
              input({
                type: 'text',
                value: (s: State) => s.summary,
                onInput: (e: Event) =>
                  send({
                    type: 'setField',
                    field: 'summary',
                    value: (e.target as HTMLInputElement).value,
                  }),
              }),
            ]),
          ],
          4: () => [
            div({ class: 'step confirmation' }, [
              text((s) => `Name: ${s.name}`),
              text((s) => `Email: ${s.email}`),
              text((s) => `Summary: ${s.summary}`),
            ]),
          ],
        },
      }),
      div({ class: 'controls' }, [
        button(
          {
            onClick: () => send({ type: 'back' }),
            disabled: (s: State) => s.step === 1,
          },
          [text('Back')],
        ),
        button(
          {
            onClick: () => send({ type: 'next' }),
            disabled: (s: State) => s.step >= 4 || !isStepValid(s),
          },
          [text('Next')],
        ),
        button(
          {
            onClick: () => send({ type: 'submit' }),
            disabled: (s: State) => s.step !== 4,
          },
          [text('Submit')],
        ),
      ]),
    ]),
  ],
})
