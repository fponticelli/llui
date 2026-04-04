import type { Send } from '@llui/dom'

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
  | { type: 'toggle' }
  | { type: 'setChecked'; checked: CheckedState }
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

export interface CheckboxParts<S> {
  /** The visual box/container — `role="checkbox"` for accessibility. */
  root: {
    role: 'checkbox'
    'aria-checked': (s: S) => 'true' | 'false' | 'mixed'
    'aria-disabled': (s: S) => 'true' | undefined
    'aria-required': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'checked' | 'unchecked' | 'indeterminate'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'checkbox'
    'data-part': 'root'
    tabIndex: (s: S) => number
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  /** A native hidden input for form participation. */
  hiddenInput: {
    type: 'checkbox'
    'aria-hidden': 'true'
    tabIndex: -1
    style: string
    checked: (s: S) => boolean
    indeterminate: (s: S) => boolean
    disabled: (s: S) => boolean
    required: (s: S) => boolean
    'data-scope': 'checkbox'
    'data-part': 'hidden-input'
  }
  /** Optional indicator child (the checkmark). */
  indicator: {
    'data-state': (s: S) => 'checked' | 'unchecked' | 'indeterminate'
    'data-scope': 'checkbox'
    'data-part': 'indicator'
  }
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect<S>(
  get: (s: S) => CheckboxState,
  send: Send<CheckboxMsg>,
): CheckboxParts<S> {
  return {
    root: {
      role: 'checkbox',
      'aria-checked': (s) => ariaChecked(get(s).checked),
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'aria-required': (s) => (get(s).required ? 'true' : undefined),
      'data-state': (s) => dataState(get(s).checked),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-scope': 'checkbox',
      'data-part': 'root',
      tabIndex: (s) => (get(s).disabled ? -1 : 0),
      onClick: () => send({ type: 'toggle' }),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === ' ') {
          e.preventDefault()
          send({ type: 'toggle' })
        }
      },
    },
    hiddenInput: {
      type: 'checkbox',
      'aria-hidden': 'true',
      tabIndex: -1,
      style: HIDDEN_STYLE,
      checked: (s) => get(s).checked === true,
      indeterminate: (s) => get(s).checked === 'indeterminate',
      disabled: (s) => get(s).disabled,
      required: (s) => get(s).required,
      'data-scope': 'checkbox',
      'data-part': 'hidden-input',
    },
    indicator: {
      'data-state': (s) => dataState(get(s).checked),
      'data-scope': 'checkbox',
      'data-part': 'indicator',
    },
  }
}

export const checkbox = { init, update, connect }
