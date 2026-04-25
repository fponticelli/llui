import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

/**
 * Password input — text input with show/hide visibility toggle.
 */

export interface PasswordInputState {
  value: string
  visible: boolean
  disabled: boolean
}

export type PasswordInputMsg =
  /** @intent("Set Value") */
  | { type: 'setValue'; value: string }
  /** @intent("Toggle Visibility") */
  | { type: 'toggleVisibility' }
  /** @intent("Set Visible") */
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

export interface PasswordInputParts<S> {
  root: {
    'data-scope': 'password-input'
    'data-part': 'root'
    'data-visible': (s: S) => '' | undefined
    'data-disabled': (s: S) => '' | undefined
  }
  input: {
    type: (s: S) => 'text' | 'password'
    autoComplete: string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'password-input'
    'data-part': 'input'
    onInput: (e: Event) => void
  }
  visibilityTrigger: {
    type: 'button'
    'aria-label': (s: S) => string
    'aria-pressed': (s: S) => boolean
    disabled: (s: S) => boolean
    tabIndex: -1
    'data-scope': 'password-input'
    'data-part': 'visibility-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  autoComplete?: string
  showLabel?: string
  hideLabel?: string
}

export function connect<S>(
  get: (s: S) => PasswordInputState,
  send: Send<PasswordInputMsg>,
  opts: ConnectOptions = {},
): PasswordInputParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const autoComplete = opts.autoComplete ?? 'current-password'
  const showLabel = opts.showLabel
  const hideLabel = opts.hideLabel

  return {
    root: {
      'data-scope': 'password-input',
      'data-part': 'root',
      'data-visible': (s) => (get(s).visible ? '' : undefined),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    input: {
      type: (s) => (get(s).visible ? 'text' : 'password'),
      autoComplete,
      disabled: (s) => get(s).disabled,
      value: (s) => get(s).value,
      'data-scope': 'password-input',
      'data-part': 'input',
      onInput: (e) => send({ type: 'setValue', value: (e.target as HTMLInputElement).value }),
    },
    visibilityTrigger: {
      type: 'button',
      'aria-label': (s) =>
        get(s).visible
          ? (hideLabel ?? locale(s).passwordInput.hide)
          : (showLabel ?? locale(s).passwordInput.show),
      'aria-pressed': (s) => get(s).visible,
      disabled: (s) => get(s).disabled,
      tabIndex: -1,
      'data-scope': 'password-input',
      'data-part': 'visibility-trigger',
      onClick: () => send({ type: 'toggleVisibility' }),
    },
  }
}

export const passwordInput = { init, update, connect }
