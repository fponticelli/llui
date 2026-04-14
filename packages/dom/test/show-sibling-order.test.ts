import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { div, p, input } from '../src/elements'
import type { ComponentDef } from '../src/types'

// Repro for issue #4 (reset-password page):
// Three sibling show() blocks, with nested show() blocks inside the middle one.
// Transition that flips the middle and last branches simultaneously must mount
// the last branch even though the middle's old scope disposes nested blocks
// (splicing them out of inst.structuralBlocks mid-iteration over the flat array).

type State = {
  token: string
  success: boolean
  errors: { newPassword?: string; confirmPassword?: string; form?: string }
}
type Msg = { type: 'submit' } | { type: 'setErr'; field: 'newPassword'; msg: string }

function resetDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Reset',
    init: () => [{ token: 'abc', success: false, errors: {} }, []],
    update: (s, msg) => {
      switch (msg.type) {
        case 'submit':
          return [{ ...s, success: true }, []]
        case 'setErr':
          return [{ ...s, errors: { ...s.errors, [msg.field]: msg.msg } }, []]
      }
    },
    view: ({ text: t, show }) => [
      div({ class: 'wrap' }, [
        // Branch A: invalid link
        ...show({
          when: (s) => s.token === '',
          render: () => [p({}, [t('Invalid link.')])],
        }),
        // Branch B: the form, with nested field-error shows
        ...show({
          when: (s) => s.token !== '' && !s.success,
          render: () => [
            div({ class: 'form' }, [
              input({ name: 'newPassword' }),
              ...show({
                when: (s) => s.errors.newPassword !== undefined,
                render: () => [p({ class: 'err-new' }, [t('err-new')])],
              }),
              input({ name: 'confirmPassword' }),
              ...show({
                when: (s) => s.errors.confirmPassword !== undefined,
                render: () => [p({ class: 'err-conf' }, [t('err-conf')])],
              }),
              ...show({
                when: (s) => s.errors.form !== undefined,
                render: () => [p({ class: 'err-form' }, [t('err-form')])],
              }),
            ]),
          ],
        }),
        // Branch C: success
        ...show({
          when: (s) => s.success,
          render: () => [p({ class: 'success' }, [t('Password reset.')])],
        }),
      ]),
    ],
    // No __dirty → FULL_MASK → generic Phase 1 + Phase 2 path
  }
}

describe('sibling show() blocks with nested shows', () => {
  let sendFn: (msg: Msg) => void

  function mount() {
    const def = resetDef()
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, def)
    return { container, handle }
  }

  it('renders the success branch after the form branch when transitioning', () => {
    const { container, handle } = mount()

    expect(container.querySelector('.form')).not.toBeNull()
    expect(container.querySelector('.success')).toBeNull()

    sendFn({ type: 'submit' })
    handle.flush()

    expect(container.querySelector('.form')).toBeNull()
    expect(container.querySelector('.success')).not.toBeNull()
    expect(container.textContent).toContain('Password reset.')

    handle.dispose()
    container.remove()
  })

  it('renders success branch even with nested error shows previously activated', () => {
    const { container, handle } = mount()

    sendFn({ type: 'setErr', field: 'newPassword', msg: 'bad' })
    handle.flush()
    expect(container.querySelector('.err-new')).not.toBeNull()

    sendFn({ type: 'submit' })
    handle.flush()

    expect(container.querySelector('.form')).toBeNull()
    expect(container.querySelector('.success')).not.toBeNull()

    handle.dispose()
    container.remove()
  })
})
