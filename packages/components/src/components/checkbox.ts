import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Checkbox — a tri-state form control (checked / unchecked / indeterminate).
 * The `indeterminate` state is a visual-only state used to represent "partial"
 * selection (e.g. a parent whose children are mixed checked).
 *
 * Rendering typically uses two elements: a visual indicator (the styled box)
 * and a hidden native `<input type="checkbox">` for form participation +
 * accessibility. `connect()` returns props for both.
 */

export type CheckedState = boolean | 'indeterminate'

export interface CheckboxState {
  checked: CheckedState
  disabled: boolean
  required: boolean
}

export type CheckboxMsg =
  /** @intent("Toggle the checkbox between checked and unchecked") */
  | { type: 'toggle' }
  /** @intent("Set the checkbox state to checked, unchecked, or indeterminate") */
  | { type: 'setChecked'; checked: CheckedState }
  /** @humanOnly */
  | { type: 'setDisabled'; disabled: boolean }

export interface CheckboxInit {
  checked?: CheckedState
  disabled?: boolean
  required?: boolean
}

export function init(opts: CheckboxInit = {}): CheckboxState {
  return {
    checked: opts.checked ?? false,
    disabled: opts.disabled ?? false,
    required: opts.required ?? false,
  }
}

export function update(state: CheckboxState, msg: CheckboxMsg): [CheckboxState, never[]] {
  switch (msg.type) {
    case 'toggle':
      if (state.disabled) return [state, []]
      // Tri-state toggle: indeterminate → checked, otherwise flip boolean
      if (state.checked === 'indeterminate') return [{ ...state, checked: true }, []]
      return [{ ...state, checked: !state.checked }, []]
    case 'setChecked':
      return [{ ...state, checked: msg.checked }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

function ariaChecked(c: CheckedState): 'true' | 'false' | 'mixed' {
  if (c === 'indeterminate') return 'mixed'
  return c ? 'true' : 'false'
}

function dataState(c: CheckedState): 'checked' | 'unchecked' | 'indeterminate' {
  if (c === 'indeterminate') return 'indeterminate'
  return c ? 'checked' : 'unchecked'
}

export interface CheckboxParts {
  /** The visual box/container — `role="checkbox"` for accessibility. */
  root: {
    role: 'checkbox'
    'aria-checked': Signal<'true' | 'false' | 'mixed'>
    'aria-disabled': Signal<'true' | undefined>
    'aria-required': Signal<'true' | undefined>
    'data-state': Signal<'checked' | 'unchecked' | 'indeterminate'>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'checkbox'
    'data-part': 'root'
    tabindex: Signal<number>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  /** A native hidden input for form participation. */
  hiddenInput: {
    type: 'checkbox'
    'aria-hidden': 'true'
    tabindex: -1
    style: string
    checked: Signal<boolean>
    indeterminate: Signal<boolean>
    disabled: Signal<boolean>
    required: Signal<boolean>
    'data-scope': 'checkbox'
    'data-part': 'hidden-input'
  }
  /** Optional indicator child (the checkmark). */
  indicator: {
    'data-state': Signal<'checked' | 'unchecked' | 'indeterminate'>
    'data-scope': 'checkbox'
    'data-part': 'indicator'
  }
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect(state: Signal<CheckboxState>, send: Send<CheckboxMsg>): CheckboxParts {
  return {
    root: {
      role: 'checkbox',
      'aria-checked': state.map((s) => ariaChecked(s.checked)),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'aria-required': state.map((s) => (s.required ? 'true' : undefined)),
      'data-state': state.map((s) => dataState(s.checked)),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-scope': 'checkbox',
      'data-part': 'root',
      tabindex: state.map((s) => (s.disabled ? -1 : 0)),
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
      onKeyDown: tagSend(send, ['toggle'], (e: KeyboardEvent) => {
        if (e.key === ' ') {
          e.preventDefault()
          send({ type: 'toggle' })
        }
      }),
    },
    hiddenInput: {
      type: 'checkbox',
      'aria-hidden': 'true',
      tabindex: -1,
      style: HIDDEN_STYLE,
      checked: state.map((s) => s.checked === true),
      indeterminate: state.map((s) => s.checked === 'indeterminate'),
      disabled: state.map((s) => s.disabled),
      required: state.map((s) => s.required),
      'data-scope': 'checkbox',
      'data-part': 'hidden-input',
    },
    indicator: {
      'data-state': state.map((s) => dataState(s.checked)),
      'data-scope': 'checkbox',
      'data-part': 'indicator',
    },
  }
}

export const checkbox = { init, update, connect }
