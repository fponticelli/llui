import { div, h1, p, a, form, fieldset, input, button, ul, li, text, each } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'

export function loginPage(_s: State, send: Send<Msg>): HTMLElement[] {
  return [authPage('Sign in', '#/register', 'Need an account?', send, false)]
}

export function registerPage(_s: State, send: Send<Msg>): HTMLElement[] {
  return [authPage('Sign up', '#/login', 'Have an account?', send, true)]
}

function authPage(
  title: string,
  altHref: string,
  altText: string,
  send: Send<Msg>,
  isRegister: boolean,
): HTMLElement {
  return div({ class: 'auth-page' }, [
    div({ class: 'container page' }, [
      div({ class: 'row' }, [
        div({ class: 'col-md-6 offset-md-3 col-xs-12' }, [
          h1({ class: 'text-xs-center' }, [text(title)]),
          p({ class: 'text-xs-center' }, [
            a({ href: altHref }, [text(altText)]),
          ]),
          ...errorList(send),
          form(
            {
              onSubmit: (e: Event) => {
                e.preventDefault()
                send({ type: isRegister ? 'submitRegister' : 'submitLogin' })
              },
            },
            [
              fieldset({ class: 'form-group' }, [
                ...(isRegister
                  ? [
                      input({
                        class: 'form-control form-control-lg',
                        type: 'text',
                        placeholder: 'Your Name',
                        value: (s: State) => s.authUsername,
                        onInput: (e: Event) =>
                          send({
                            type: 'setField',
                            field: 'authUsername',
                            value: (e.target as HTMLInputElement).value,
                          }),
                      }),
                    ]
                  : []),
                input({
                  class: 'form-control form-control-lg',
                  type: 'text',
                  placeholder: 'Email',
                  value: (s: State) => s.authEmail,
                  onInput: (e: Event) =>
                    send({
                      type: 'setField',
                      field: 'authEmail',
                      value: (e.target as HTMLInputElement).value,
                    }),
                }),
                input({
                  class: 'form-control form-control-lg',
                  type: 'password',
                  placeholder: 'Password',
                  value: (s: State) => s.authPassword,
                  onInput: (e: Event) =>
                    send({
                      type: 'setField',
                      field: 'authPassword',
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
                [text(title)],
              ),
            ],
          ),
        ]),
      ]),
    ]),
  ])
}

export function errorList(_send: Send<Msg>): Node[] {
  return each<State, string, Msg>({
    items: (s) => s.errors,
    key: (e) => e,
    render: ({ item }) => [
      ul({ class: 'error-messages' }, [li({}, [text(item((e) => e))])]),
    ],
  })
}
