import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'

/**
 * Password input — text input with show/hide visibility toggle.
 */

export interface PasswordInputState {
  value: string
  visible: boolean
  disabled: boolean
}

export type PasswordInputMsg =
  /** @intent("Update the password value as the user types") */
  | { type: 'setValue'; value: string }
  /** @intent("Toggle the show/hide-password state") */
  | { type: 'toggleVisibility' }
  /** @intent("Set the show/hide-password state to a specific value") */
  | { type: 'setVisible'; visible: boolean }

export interface PasswordInputInit {
  value?: string
  visible?: boolean
  disabled?: boolean
}

export function init(opts: PasswordInputInit = {}): PasswordInputState {
  return {
    value: opts.value ?? '',
    visible: opts.visible ?? false,
    disabled: opts.disabled ?? false,
  }
}

export function update(
  state: PasswordInputState,
  msg: PasswordInputMsg,
): [PasswordInputState, never[]] {
  if (state.disabled && msg.type !== 'setValue') return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'toggleVisibility':
      return [{ ...state, visible: !state.visible }, []]
    case 'setVisible':
      return [{ ...state, visible: msg.visible }, []]
  }
}

export interface PasswordInputParts {
  root: {
    'data-scope': 'password-input'
    'data-part': 'root'
    'data-visible': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
  }
  input: {
    type: Signal<'text' | 'password'>
    autocomplete: string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'password-input'
    'data-part': 'input'
    onInput: (e: Event) => void
  }
  visibilityTrigger: {
    type: 'button'
    'aria-label': Signal<string>
    'aria-pressed': Signal<boolean>
    disabled: Signal<boolean>
    tabindex: -1
    'data-scope': 'password-input'
    'data-part': 'visibility-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  autocomplete?: string
  showLabel?: string
  hideLabel?: string
}

export function connect(
  state: Signal<PasswordInputState>,
  send: Send<PasswordInputMsg>,
  opts: ConnectOptions = {},
): PasswordInputParts {
  const locale = useContext(LocaleContext)
  const autocomplete = opts.autocomplete ?? 'current-password'
  const showLabel = opts.showLabel
  const hideLabel = opts.hideLabel

  return {
    root: {
      'data-scope': 'password-input',
      'data-part': 'root',
      'data-visible': state.map((st) => (st.visible ? '' : undefined)),
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
    },
    input: {
      type: state.map((st) => (st.visible ? 'text' : 'password')),
      autocomplete,
      disabled: state.map((st) => st.disabled),
      value: state.map((st) => st.value),
      'data-scope': 'password-input',
      'data-part': 'input',
      onInput: tagSend(send, ['setValue'], (e) =>
        send({ type: 'setValue', value: (e.target as HTMLInputElement).value }),
      ),
    },
    visibilityTrigger: {
      type: 'button',
      'aria-label': state.map((st) =>
        st.visible
          ? (hideLabel ?? locale.passwordInput.hide)
          : (showLabel ?? locale.passwordInput.show),
      ),
      'aria-pressed': state.map((st) => st.visible),
      disabled: state.map((st) => st.disabled),
      tabindex: -1,
      'data-scope': 'password-input',
      'data-part': 'visibility-trigger',
      onClick: tagSend(send, ['toggleVisibility'], () => send({ type: 'toggleVisibility' })),
    },
  }
}

export const passwordInput = { init, update, connect }
