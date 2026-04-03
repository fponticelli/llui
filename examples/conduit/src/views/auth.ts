import { div, h1, p, a, form, fieldset, input, button, ul, li, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'

export function loginPage(s: State, send: Send<Msg>): HTMLElement[] {
  return [authPage('Sign in', '#/register', 'Need an account?', s, send, false)]
}

export function registerPage(s: State, send: Send<Msg>): HTMLElement[] {
  return [authPage('Sign up', '#/login', 'Have an account?', s, send, true)]
}

function authPage(title: string, altHref: string, altText: string, s: State, send: Send<Msg>, isRegister: boolean): HTMLElement {
  return div({ class: 'auth-page' }, [
    div({ class: 'container page' }, [
      div({ class: 'row' }, [
        div({ class: 'col-md-6 offset-md-3 col-xs-12' }, [
          h1({ class: 'text-xs-center' }, [text(title)]),
          p({ class: 'text-xs-center' }, [
            a({ href: altHref }, [text(altText)]),
          ]),
          errorList(s.errors),
          form({
            onSubmit: (e: Event) => {
              e.preventDefault()
              send({ type: isRegister ? 'submitRegister' : 'submitLogin' })
            },
          }, [
            fieldset({ class: 'form-group' }, [
              ...(isRegister
                ? [input({
                    class: 'form-control form-control-lg',
                    type: 'text',
                    placeholder: 'Your Name',
                    value: s.authUsername,
                    onInput: (e: Event) => send({ type: 'setField', field: 'authUsername', value: (e.target as HTMLInputElement).value }),
                  })]
                : []),
              input({
                class: 'form-control form-control-lg',
                type: 'text',
                placeholder: 'Email',
                value: s.authEmail,
                onInput: (e: Event) => send({ type: 'setField', field: 'authEmail', value: (e.target as HTMLInputElement).value }),
              }),
              input({
                class: 'form-control form-control-lg',
                type: 'password',
                placeholder: 'Password',
                value: s.authPassword,
                onInput: (e: Event) => send({ type: 'setField', field: 'authPassword', value: (e.target as HTMLInputElement).value }),
              }),
            ]),
            button({
              class: 'btn btn-lg btn-primary pull-xs-right',
              type: 'submit',
              disabled: s.loading,
            }, [text(title)]),
          ]),
        ]),
      ]),
    ]),
  ])
}

export function errorList(errors: string[]): HTMLElement {
  if (errors.length === 0) return ul({}, [])
  return ul({ class: 'error-messages' }, [
    ...errors.map((err) => li({}, [text(err)])),
  ])
}
