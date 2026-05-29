import { tagSend } from '@llui/dom/signals'
import type { Send, Signal } from '@llui/dom/signals'

/**
 * Switch — two-state on/off control. Semantically like a checkbox but
 * visually a toggle track + thumb. Uses `role="switch"` for ARIA.
 */

export interface SwitchState {
  checked: boolean
  disabled: boolean
}

export type SwitchMsg =
  /** @intent("Flip the switch on/off") */
  | { type: 'toggle' }
  /** @intent("Set the switch's checked state to a specific value") */
  | { type: 'setChecked'; checked: boolean }
  /** @humanOnly */
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

export interface SwitchParts {
  root: {
    role: 'switch'
    'aria-checked': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    'data-state': Signal<'checked' | 'unchecked'>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'switch'
    'data-part': 'root'
    tabIndex: Signal<number>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  track: {
    'data-state': Signal<'checked' | 'unchecked'>
    'data-scope': 'switch'
    'data-part': 'track'
  }
  thumb: {
    'data-state': Signal<'checked' | 'unchecked'>
    'data-scope': 'switch'
    'data-part': 'thumb'
  }
  hiddenInput: {
    type: 'checkbox'
    role: 'switch'
    'aria-hidden': 'true'
    tabIndex: -1
    style: string
    checked: Signal<boolean>
    disabled: Signal<boolean>
    'data-scope': 'switch'
    'data-part': 'hidden-input'
  }
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect(state: Signal<SwitchState>, send: Send<SwitchMsg>): SwitchParts {
  return {
    root: {
      role: 'switch',
      'aria-checked': state.map((s) => s.checked),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'data-state': state.map((s) => (s.checked ? 'checked' : 'unchecked')),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-scope': 'switch',
      'data-part': 'root',
      tabIndex: state.map((s) => (s.disabled ? -1 : 0)),
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
      onKeyDown: tagSend(send, ['toggle'], (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          send({ type: 'toggle' })
        }
      }),
    },
    track: {
      'data-state': state.map((s) => (s.checked ? 'checked' : 'unchecked')),
      'data-scope': 'switch',
      'data-part': 'track',
    },
    thumb: {
      'data-state': state.map((s) => (s.checked ? 'checked' : 'unchecked')),
      'data-scope': 'switch',
      'data-part': 'thumb',
    },
    hiddenInput: {
      type: 'checkbox',
      role: 'switch',
      'aria-hidden': 'true',
      tabIndex: -1,
      style: HIDDEN_STYLE,
      checked: state.map((s) => s.checked),
      disabled: state.map((s) => s.disabled),
      'data-scope': 'switch',
      'data-part': 'hidden-input',
    },
  }
}

export const switchMachine = { init, update, connect }
