import { div, h1, form, fieldset, input, textarea, button, hr, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'
import { errorList } from './auth'

export function settingsPage(_s: State, send: Send<Msg>): HTMLElement[] {
  return [
    div({ class: 'settings-page' }, [
      div({ class: 'container page' }, [
        div({ class: 'row' }, [
          div({ class: 'col-md-6 offset-md-3 col-xs-12' }, [
            h1({ class: 'text-xs-center' }, [text('Your Settings')]),
            ...errorList(send),
            form(
              {
                onSubmit: (e: Event) => {
                  e.preventDefault()
                  send({ type: 'submitSettings' })
                },
              },
              [
                fieldset({}, [
                  fieldset({ class: 'form-group' }, [
                    input({
                      class: 'form-control',
                      type: 'text',
                      placeholder: 'URL of profile picture',
                      value: (s: State) => s.settingsImage,
                      onInput: (e: Event) =>
                        send({
                          type: 'setField',
                          field: 'settingsImage',
                          value: (e.target as HTMLInputElement).value,
                        }),
                    }),
                  ]),
                  fieldset({ class: 'form-group' }, [
                    input({
                      class: 'form-control form-control-lg',
                      type: 'text',
                      placeholder: 'Your Name',
                      value: (s: State) => s.settingsUsername,
                      onInput: (e: Event) =>
                        send({
                          type: 'setField',
                          field: 'settingsUsername',
                          value: (e.target as HTMLInputElement).value,
                        }),
                    }),
                  ]),
                  fieldset({ class: 'form-group' }, [
                    textarea({
                      class: 'form-control form-control-lg',
                      placeholder: 'Short bio about you',
                      value: (s: State) => s.settingsBio,
                      onInput: (e: Event) =>
                        send({
                          type: 'setField',
                          field: 'settingsBio',
                          value: (e.target as HTMLTextAreaElement).value,
                        }),
                    }),
                  ]),
                  fieldset({ class: 'form-group' }, [
                    input({
                      class: 'form-control form-control-lg',
                      type: 'text',
                      placeholder: 'Email',
                      value: (s: State) => s.settingsEmail,
                      onInput: (e: Event) =>
                        send({
                          type: 'setField',
                          field: 'settingsEmail',
                          value: (e.target as HTMLInputElement).value,
                        }),
                    }),
                  ]),
                  fieldset({ class: 'form-group' }, [
                    input({
                      class: 'form-control form-control-lg',
                      type: 'password',
                      placeholder: 'New Password',
                      value: (s: State) => s.settingsPassword,
                      onInput: (e: Event) =>
                        send({
                          type: 'setField',
                          field: 'settingsPassword',
                          value: (e.target as HTMLInputElement).value,
                        }),
                    }),
                  ]),
                  button(
                    {
                      class: 'btn btn-lg btn-primary pull-xs-right',
                      type: 'submit',
                      disabled: (s: State) => s.loading,
                    },
                    [text('Update Settings')],
                  ),
                ]),
              ],
            ),
            hr({}),
            button(
              {
                class: 'btn btn-outline-danger',
                onClick: () => send({ type: 'logout' }),
              },
              [text('Or click here to logout.')],
            ),
          ]),
        ]),
      ]),
    ]),
  ]
}
