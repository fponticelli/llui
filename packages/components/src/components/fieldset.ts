import type { Send, Signal } from '@llui/dom'

/**
 * Fieldset — group wiring for a set of related controls (e.g. an address block).
 *
 * The root is a native `<fieldset>` (role `group`) labelled by a `<legend>`.
 * Setting the group `disabled` disables every contained control natively (the
 * native `disabled` attribute on `<fieldset>` propagates to descendants), and is
 * mirrored to `aria-disabled` for assistive tech. An optional group-level error
 * region is exposed for cross-field validation messages.
 *
 * ```ts
 * const g = fieldset.connect(state.at('billing'), send, { id: 'billing' })
 * el('fieldset', g.root, [
 *   el('legend', g.legend, [text('Billing address')]),
 *   // ...fields...
 *   show(state.map((s) => s.billing.invalid),
 *     () => el('p', g.errorText, [text('Address is incomplete.')])),
 * ])
 * ```
 */

export interface FieldsetState {
  /** Base id from which the legend / error ids derive. */
  id: string
  disabled: boolean
  invalid: boolean
}

export type FieldsetMsg =
  /** @intent("Enable or disable the whole group (propagates to every contained control)") */
  | { type: 'setDisabled'; disabled: boolean }
  /** @intent("Mark the group as valid or invalid (drives the group-level error region)") */
  | { type: 'setInvalid'; invalid: boolean }

export interface FieldsetInit {
  id: string
  disabled?: boolean
  invalid?: boolean
}

export function init(opts: FieldsetInit): FieldsetState {
  return {
    id: opts.id,
    disabled: opts.disabled ?? false,
    invalid: opts.invalid ?? false,
  }
}

export function update(state: FieldsetState, msg: FieldsetMsg): [FieldsetState, never[]] {
  switch (msg.type) {
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
    case 'setInvalid':
      return [{ ...state, invalid: msg.invalid }, []]
  }
}

export interface FieldsetParts {
  /** Spread onto a native `<fieldset>` element (role `group`). */
  root: {
    role: 'group'
    'aria-labelledby': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'fieldset'
    'data-part': 'root'
    'data-invalid': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
  }
  /** The `<legend>` naming the group. */
  legend: {
    id: string
    'data-scope': 'fieldset'
    'data-part': 'legend'
  }
  /** Group-level error message — a polite live region, rendered only while invalid. */
  errorText: {
    id: string
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'fieldset'
    'data-part': 'error'
  }
}

export interface FieldsetConnectOptions {
  /** Base id; if omitted, falls back to the id stored in state. */
  id?: string
}

export function connect(
  state: Signal<FieldsetState>,
  _send: Send<FieldsetMsg>,
  opts: FieldsetConnectOptions = {},
): FieldsetParts {
  const base = opts.id ?? state.peek().id
  const legendId = `${base}:legend`
  const errorId = `${base}:error`

  return {
    root: {
      role: 'group',
      'aria-labelledby': legendId,
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      disabled: state.map((s) => s.disabled),
      'data-scope': 'fieldset',
      'data-part': 'root',
      'data-invalid': state.map((s) => (s.invalid ? '' : undefined)),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    legend: {
      id: legendId,
      'data-scope': 'fieldset',
      'data-part': 'legend',
    },
    errorText: {
      id: errorId,
      role: 'alert',
      'aria-live': 'polite',
      'data-scope': 'fieldset',
      'data-part': 'error',
    },
  }
}

export const fieldset = { init, update, connect }
