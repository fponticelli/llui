/**
 * Task 12 — Modal Dialog (Tier 6)
 * Idiomatic score: 6/6
 */
import { component, div, button, text, show, onMount } from '@llui/dom'

type State = {
  open: boolean
  confirmed: boolean
}

type Msg = { type: 'openModal' } | { type: 'closeModal' } | { type: 'confirm' }

type Effect = never

export const Modal = component<State, Msg, Effect>({
  name: 'Modal',
  init: () => [{ open: false, confirmed: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'openModal':
        return [{ ...state, open: true }, []]
      case 'closeModal':
        return [{ ...state, open: false }, []]
      case 'confirm':
        return [{ ...state, open: false, confirmed: true }, []]
    }
  },
  view: (send) => [
    div({ class: 'modal-container' }, [
      button(
        {
          class: 'open-btn',
          onClick: () => send({ type: 'openModal' }),
        },
        [text('Open Modal')],
      ),
      ...show<State>({
        when: (s) => s.confirmed,
        render: () => [div({ class: 'confirmation' }, [text('Confirmed!')])],
      }),
      ...show<State>({
        when: (s) => s.open,
        render: () => {
          onMount((el) => {
            const modal = el as HTMLElement
            const focusableSelector =
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            const firstFocusable = modal.querySelector<HTMLElement>(focusableSelector)
            firstFocusable?.focus()

            const trapFocus = (e: KeyboardEvent) => {
              if (e.key === 'Escape') {
                send({ type: 'closeModal' })
                return
              }
              if (e.key !== 'Tab') return
              const focusables = modal.querySelectorAll<HTMLElement>(focusableSelector)
              if (focusables.length === 0) return
              const first = focusables[0]!
              const last = focusables[focusables.length - 1]!
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
              }
            }

            document.addEventListener('keydown', trapFocus)
            return () => document.removeEventListener('keydown', trapFocus)
          })

          return [
            div(
              {
                class: 'overlay',
                onClick: () => send({ type: 'closeModal' }),
              },
              [
                div(
                  {
                    class: 'modal',
                    onClick: (e: Event) => e.stopPropagation(),
                  },
                  [
                    div({ class: 'modal-header' }, [
                      text('Modal Title'),
                      button(
                        {
                          class: 'close-btn',
                          onClick: () => send({ type: 'closeModal' }),
                        },
                        [text('\u00d7')],
                      ),
                    ]),
                    div({ class: 'modal-body' }, [text('This is the modal body content.')]),
                    div({ class: 'modal-footer' }, [
                      button(
                        {
                          class: 'confirm-btn',
                          onClick: () => send({ type: 'confirm' }),
                        },
                        [text('Confirm')],
                      ),
                    ]),
                  ],
                ),
              ],
            ),
          ]
        },
      }),
    ]),
  ],
})
