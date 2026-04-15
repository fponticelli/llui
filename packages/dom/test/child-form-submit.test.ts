import { describe, it, expect } from 'vitest'
import {
  mountApp,
  component,
  div,
  form,
  button,
  input,
  text,
  child,
  portal,
  show,
} from '../src/index'
import type { ComponentDef } from '../src/types'

// Reproducer for issue #10 against 0.0.17: form onSubmit inside a
// child component fails to reach the child's update handler when the
// parent passes a concrete ComponentDef directly (without a widenDef
// wrapper). Anchor onClick handlers in the same child work, so the
// issue is narrow to form submission bubbling through the child
// instance boundary.

type DialogState = {
  email: string
  submitCount: number
  error: string | null
}

type DialogMsg = { type: 'setEmail'; value: string } | { type: 'submit' }

// Concrete component with a form that dispatches on submit. No widenDef
// wrapper — passed directly into `child({ def })`.
const AuthDialog: ComponentDef<DialogState, DialogMsg, never> = {
  name: 'AuthDialog',
  init: () => [{ email: '', submitCount: 0, error: null }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setEmail':
        return [{ ...state, email: msg.value }, []]
      case 'submit':
        return [{ ...state, submitCount: state.submitCount + 1 }, []]
    }
  },
  view: ({ send }) => [
    div({ class: 'auth-dialog' }, [
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
            class: 'email-input',
            type: 'email',
            value: (s: DialogState) => s.email,
            onInput: (e: Event) =>
              send({
                type: 'setEmail',
                value: (e.target as HTMLInputElement).value,
              }),
          }),
          button({ class: 'submit-btn', type: 'submit' }, [text('Sign in')]),
          div({ class: 'submit-count' }, [text((s: DialogState) => String(s.submitCount))]),
        ],
      ),
    ]),
  ],
}

type ParentState = { dialogOpen: boolean }
type ParentMsg = { type: 'noop' }

function makeParent(): ComponentDef<ParentState, ParentMsg, never> {
  return {
    name: 'Parent',
    init: () => [{ dialogOpen: true }, []],
    update: (s) => [s, []],
    view: () => [
      div({ class: 'parent' }, [
        ...child<ParentState, DialogMsg>({
          def: AuthDialog,
          key: 'auth',
          props: () => ({}),
        }),
      ]),
    ],
  }
}

describe('child component form submit regression (issue #10)', () => {
  it('form onSubmit inside a child dispatches into the child update handler', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeParent())

    // The child's form is rendered. Initial submit count is 0.
    const formEl = container.querySelector('.auth-form') as HTMLFormElement
    expect(formEl).not.toBeNull()
    const countEl = container.querySelector('.submit-count') as HTMLElement
    expect(countEl.textContent).toBe('0')

    // Dispatch a submit event. The onSubmit handler calls
    // preventDefault and send({ type: 'submit' }) — the child's
    // update should bump submitCount to 1.
    formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    handle.flush()
    // Propagation through child.send → microtask → child update loop
    await Promise.resolve()
    await Promise.resolve()
    handle.flush()

    expect(countEl.textContent).toBe('1')

    handle.dispose()
    container.remove()
  })

  it('clicking a submit-type button inside a child form dispatches the submit message', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeParent())

    const submitBtn = container.querySelector('.submit-btn') as HTMLButtonElement
    const countEl = container.querySelector('.submit-count') as HTMLElement
    expect(countEl.textContent).toBe('0')

    // Clicking a type="submit" button inside a form dispatches a
    // submit event on the form. This is the exact scenario the
    // Playwright test hits: user clicks "Sign in", form submit fires,
    // the reducer runs.
    submitBtn.click()
    handle.flush()
    await Promise.resolve()
    await Promise.resolve()
    handle.flush()

    expect(countEl.textContent).toBe('1')

    handle.dispose()
    container.remove()
  })

  it('input onChange inside a child component still dispatches (control case)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeParent())

    const inputEl = container.querySelector('.email-input') as HTMLInputElement
    inputEl.value = 'alice@example.com'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    handle.flush()
    await Promise.resolve()
    handle.flush()

    // Input should update the child state — the input's value binding
    // should reflect it on the next reconcile.
    expect(inputEl.value).toBe('alice@example.com')

    handle.dispose()
    container.remove()
  })
})

// ── Portal + onMsg variant — closer to the user's setup ──────────────

type PortalDialogState = {
  open: boolean
  submitCount: number
}

type PortalDialogMsg = { type: 'open' } | { type: 'close' } | { type: 'submit' }

// Child component whose view wraps a form inside a portal. This
// mirrors how @llui/components/dialog.overlay works: the dialog's
// visible content lives in a `portal({ target: 'body' })` so it
// escapes its parent's stacking context.
const PortalAuthDialog: ComponentDef<PortalDialogState, PortalDialogMsg, never> = {
  name: 'PortalAuthDialog',
  init: () => [{ open: true, submitCount: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'open':
        return [{ ...state, open: true }, []]
      case 'close':
        return [{ ...state, open: false }, []]
      case 'submit':
        return [{ ...state, submitCount: state.submitCount + 1 }, []]
    }
  },
  view: ({ send, show: showBag }) => [
    // Outer marker so we can assert the child's direct-render output
    // exists in the parent container.
    div({ class: 'dialog-anchor' }),
    // Portal the form to body — the form element will NOT live inside
    // the parent container, it'll be a direct child of document.body.
    ...showBag({
      when: (s) => s.open,
      render: () => [
        ...portal({
          target: 'body',
          render: () => [
            div({ class: 'dialog-overlay' }, [
              form(
                {
                  class: 'portaled-form',
                  onSubmit: (e: Event) => {
                    e.preventDefault()
                    send({ type: 'submit' })
                  },
                },
                [
                  input({ class: 'portaled-email', type: 'email' }),
                  button({ class: 'portaled-submit', type: 'submit' }, [text('Sign in')]),
                  div({ class: 'portaled-count' }, [
                    text((s: PortalDialogState) => String(s.submitCount)),
                  ]),
                ],
              ),
            ]),
          ],
        }),
      ],
    }),
  ],
}

type ParentWithPortalState = { _: null }
type ParentWithPortalMsg = { type: 'dialogClosed' }

function makeParentWithPortal(onMsgCalls: {
  count: number
}): ComponentDef<ParentWithPortalState, ParentWithPortalMsg, never> {
  return {
    name: 'ParentWithPortal',
    init: () => [{ _: null }, []],
    update: (s) => [s, []],
    view: () => [
      div({ class: 'parent-with-portal' }, [
        ...child<ParentWithPortalState, PortalDialogMsg>({
          def: PortalAuthDialog,
          key: 'portaled-auth',
          props: () => ({}),
          // onMsg IS provided — the send-interception wraps an active
          // forwarding function, not the no-forwarding early exit.
          onMsg: (_msg) => {
            onMsgCalls.count++
            return null
          },
        }),
      ]),
    ],
  }
}

describe('child → portal → form onSubmit regression probe', () => {
  it('form submit inside a portal inside a child still dispatches', async () => {
    const onMsgCalls = { count: 0 }
    document.body.innerHTML = ''
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeParentWithPortal(onMsgCalls))

    // The dialog rendered via portal to body — the form is not inside
    // `container`, it's a direct body child.
    const formEl = document.querySelector('.portaled-form') as HTMLFormElement
    expect(formEl).not.toBeNull()
    expect(formEl.parentElement?.parentElement).toBe(document.body)

    // Sanity: the anchor is inside the parent's container (not portaled).
    expect(container.querySelector('.dialog-anchor')).not.toBeNull()

    const countEl = document.querySelector('.portaled-count') as HTMLElement
    expect(countEl.textContent).toBe('0')

    // Submit the form.
    formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    handle.flush()
    await Promise.resolve()
    await Promise.resolve()
    handle.flush()

    expect(countEl.textContent, 'child submitCount should increment to 1').toBe('1')
    // onMsg was called because the child dispatched a message that got
    // forwarded to the parent (via the child.ts send wrap). Submit
    // event → child.send → originalSend + queueMicrotask(onMsg forward).
    await Promise.resolve()
    expect(onMsgCalls.count, 'parent onMsg was called').toBeGreaterThan(0)

    handle.dispose()
    document.body.innerHTML = ''
  })

  it('clicking a submit-type button inside a portaled child form also dispatches', async () => {
    const onMsgCalls = { count: 0 }
    document.body.innerHTML = ''
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeParentWithPortal(onMsgCalls))

    const submitBtn = document.querySelector('.portaled-submit') as HTMLButtonElement
    const countEl = document.querySelector('.portaled-count') as HTMLElement
    expect(submitBtn).not.toBeNull()
    expect(countEl.textContent).toBe('0')

    submitBtn.click()
    handle.flush()
    await Promise.resolve()
    await Promise.resolve()
    handle.flush()

    expect(countEl.textContent, 'submit-button click inside portal should fire child reducer').toBe(
      '1',
    )

    handle.dispose()
    document.body.innerHTML = ''
  })
})
