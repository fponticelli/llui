import type { Send } from '@llui/dom'

/**
 * Switch — two-state on/off control. Semantically like a checkbox but
 * visually a toggle track + thumb. Uses `role="switch"` for ARIA.
 */

export interface SwitchState {
  checked: boolean
  disabled: boolean
}

export type SwitchMsg =
  | { type: 'toggle' }
  | { type: 'setChecked'; checked: boolean }
  | { type: 'setDisabled'; disabled: boolean }

export interface SwitchInit {
  checked?: boolean
  disabled?: boolean
}

export function init(opts: SwitchInit = {}): SwitchState {
  return { checked: opts.checked ?? false, disabled: opts.disabled ?? false }
}

export function update(state: SwitchState, msg: SwitchMsg): [SwitchState, never[]] {
  switch (msg.type) {
    case 'toggle':
      if (state.disabled) return [state, []]
      return [{ ...state, checked: !state.checked }, []]
    case 'setChecked':
      return [{ ...state, checked: msg.checked }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

export interface SwitchParts<S> {
  root: {
    role: 'switch'
    'aria-checked': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'checked' | 'unchecked'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'switch'
    'data-part': 'root'
    tabIndex: (s: S) => number
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  track: {
    'data-state': (s: S) => 'checked' | 'unchecked'
    'data-scope': 'switch'
    'data-part': 'track'
  }
  thumb: {
    'data-state': (s: S) => 'checked' | 'unchecked'
    'data-scope': 'switch'
    'data-part': 'thumb'
  }
  hiddenInput: {
    type: 'checkbox'
    role: 'switch'
    'aria-hidden': 'true'
    tabIndex: -1
    style: string
    checked: (s: S) => boolean
    disabled: (s: S) => boolean
    'data-scope': 'switch'
    'data-part': 'hidden-input'
  }
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect<S>(get: (s: S) => SwitchState, send: Send<SwitchMsg>): SwitchParts<S> {
  return {
    root: {
      role: 'switch',
      'aria-checked': (s) => get(s).checked,
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-state': (s) => (get(s).checked ? 'checked' : 'unchecked'),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-scope': 'switch',
      'data-part': 'root',
      tabIndex: (s) => (get(s).disabled ? -1 : 0),
      onClick: () => send({ type: 'toggle' }),
      onKeyDown: (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          send({ type: 'toggle' })
        }
      },
    },
    track: {
      'data-state': (s) => (get(s).checked ? 'checked' : 'unchecked'),
      'data-scope': 'switch',
      'data-part': 'track',
    },
    thumb: {
      'data-state': (s) => (get(s).checked ? 'checked' : 'unchecked'),
      'data-scope': 'switch',
      'data-part': 'thumb',
    },
    hiddenInput: {
      type: 'checkbox',
      role: 'switch',
      'aria-hidden': 'true',
      tabIndex: -1,
      style: HIDDEN_STYLE,
      checked: (s) => get(s).checked,
      disabled: (s) => get(s).disabled,
      'data-scope': 'switch',
      'data-part': 'hidden-input',
    },
  }
}

export const switchMachine = { init, update, connect }
