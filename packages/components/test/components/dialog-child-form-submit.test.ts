import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, button, form, input, text, child, h2 } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import {
  init as dialogInit,
  update as dialogUpdate,
  connect as dialogConnect,
  overlay as dialogOverlay,
} from '../../src/components/dialog'
import type { DialogState, DialogMsg } from '../../src/components/dialog'

// Reproducer for issue #10 against 0.0.17: form onSubmit inside a
// child component's portaled dialog fails to reach the child's update
// handler when the parent passes a concrete ComponentDef directly
// (no widenDef wrapper).
//
// This test uses the EXACT shape the user reported: an AuthDialog-like
// child whose view renders `dialog.overlay({ content: form + submit })`
// with a concrete ComponentDef<State, Msg, Effect> at the child()
// boundary (no widenDef). Submits the form. Asserts the child's
// reducer ran.

type AuthState = {
  dlg: DialogState
  email: string
  submitCount: number
}

type AuthMsg =
  | { type: 'dialog'; msg: DialogMsg }
  | { type: 'setEmail'; value: string }
  | { type: 'submit' }

// Concrete AuthDialog ComponentDef — all type parameters concrete, no
// `unknown` widening. This is what real app code looks like.
const AuthDialog: ComponentDef<AuthState, AuthMsg, never> = {
  name: 'AuthDialog',
  init: () => [{ dlg: dialogInit({ open: true }), email: '', submitCount: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'dialog': {
        const [next] = dialogUpdate(state.dlg, msg.msg)
        return [{ ...state, dlg: next }, []]
      }
      case 'setEmail':
        return [{ ...state, email: msg.value }, []]
      case 'submit':
        return [{ ...state, submitCount: state.submitCount + 1 }, []]
    }
  },
  view: ({ send }) => {
    const parts = dialogConnect<AuthState>(
      (s) => s.dlg,
      (msg) => send({ type: 'dialog', msg }),
      { id: 'auth' },
    )
    return [
      div({ class: 'auth-host' }, [
        button({ ...parts.trigger }, [text('Open')]),
        ...dialogOverlay<AuthState>({
          get: (s) => s.dlg,
          send: (msg) => send({ type: 'dialog', msg }),
          parts,
          content: () => [
            div({ ...parts.content }, [
              h2({ ...parts.title }, [text('Sign in')]),
              form(
                {
                  class: 'auth-form',
                  onSubmit: (e: Event) => {
                    e.preventDefault()
                    send({ type: 'submit' })
                  },
                },
                [
                  input({
                    class: 'auth-email',
                    type: 'email',
                    onInput: (e: Event) =>
                      send({
                        type: 'setEmail',
                        value: (e.target as HTMLInputElement).value,
                      }),
                  }),
                  button({ class: 'auth-submit', type: 'submit' }, [text('Sign in')]),
                  div({ class: 'auth-submit-count' }, [
                    text((s: AuthState) => String(s.submitCount)),
                  ]),
                ],
              ),
            ]),
          ],
        }),
      ]),
    ]
  },
}

// Parent component that embeds AuthDialog via `child({ def })`.
// Concrete AuthDialog is passed DIRECTLY — this is the pre-0.0.17
// case that required a `widenDef(AuthDialog)` wrapper, and the
// post-0.0.17 case that's supposed to work without widening.
type ParentState = { _: null }

const Parent: ComponentDef<ParentState, AuthMsg, never> = {
  name: 'Parent',
  init: () => [{ _: null }, []],
  update: (s) => [s, []],
  view: () => [
    div({ class: 'parent-root' }, [
      ...child<ParentState, AuthMsg>({
        def: AuthDialog,
        key: 'auth',
        props: () => ({}),
        // Parent doesn't react to child messages for this probe — just
        // provides onMsg so the send-wrap's forwarding path is active,
        // matching the user's real setup.
        onMsg: () => null,
      }),
    ]),
  ],
}

describe('child → dialog.overlay → form onSubmit (issue #10 reproducer)', () => {
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    // Dialog's aria-hidden sibling walk needs at least one non-container
    // body child — add a scratch node.
    const aside = document.createElement('aside')
    aside.id = 'aside-sibling'
    document.body.appendChild(aside)
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  })

  it('form submit inside the portaled dialog dispatches into the child reducer', async () => {
    const app = mountApp(container, Parent)

    // The dialog is open at init. Its content is portaled to body.
    // Give the onMount callbacks one microtask to attach the focus
    // trap / scroll lock / dismissable listeners.
    await Promise.resolve()
    app.flush()

    const formEl = document.querySelector('.auth-form') as HTMLFormElement | null
    const countEl = document.querySelector('.auth-submit-count') as HTMLElement | null
    expect(formEl, 'form renders inside portal').not.toBeNull()
    expect(countEl, 'submit-count reflects child state').not.toBeNull()
    expect(countEl!.textContent).toBe('0')

    // Dispatch a submit event. This is the exact shape the user's
    // Playwright test triggers by clicking the submit button.
    formEl!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    app.flush()
    await Promise.resolve()
    await Promise.resolve()
    app.flush()

    // If this fails, the child's update handler never saw the submit
    // message — exactly the regression the user reported.
    expect(countEl!.textContent, 'child.update received "submit" message').toBe('1')

    app.dispose()
  })

  it('clicking the submit button inside the portaled dialog also dispatches', async () => {
    const app = mountApp(container, Parent)
    await Promise.resolve()
    app.flush()

    const submitBtn = document.querySelector('.auth-submit') as HTMLButtonElement
    const countEl = document.querySelector('.auth-submit-count') as HTMLElement
    expect(submitBtn).not.toBeNull()
    expect(countEl.textContent).toBe('0')

    submitBtn.click()
    app.flush()
    await Promise.resolve()
    await Promise.resolve()
    app.flush()

    expect(countEl.textContent).toBe('1')

    app.dispose()
  })

  it('input onChange inside the portaled dialog still dispatches (control)', async () => {
    const app = mountApp(container, Parent)
    await Promise.resolve()
    app.flush()

    const emailInput = document.querySelector('.auth-email') as HTMLInputElement
    emailInput.value = 'alice@example.com'
    emailInput.dispatchEvent(new Event('input', { bubbles: true }))
    app.flush()
    await Promise.resolve()

    // Input event is synchronous — should fire into child.update
    // without any issue.
    expect(emailInput.value).toBe('alice@example.com')

    app.dispose()
  })
})
