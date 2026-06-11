import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Field — label / description / error ARIA wiring for a single form control.
 *
 * Generates a stable family of ids from one base id and wires them together
 * so the consumer never hand-writes `for` / `aria-describedby` / `aria-invalid`:
 *
 * - `label.htmlFor` → the control id (clicking the label focuses the control natively)
 * - `label.id`      → exposed as `control['aria-labelledby']` for CUSTOM controls
 *                     (combobox, listbox, etc.) that aren't a native labellable element
 * - `control['aria-describedby']` references the description id whenever a
 *   description is rendered, and ADDS the error id only while `invalid`
 * - `errorText` is a polite live region intended to be rendered only while invalid
 *
 * ```ts
 * const f = field.connect(state.at('field'), send, { id: 'email', hasDescription: true })
 * el('div', f.root, [
 *   el('label', f.label, [text('Email')]),
 *   el('input', { ...f.control, type: 'email' }),
 *   el('p', f.description, [text('We never share it.')]),
 *   show(state.map((s) => s.field.invalid),
 *     () => el('p', f.errorText, [text('Enter a valid email.')])),
 * ])
 * ```
 */

export interface FieldState {
  /** Base id from which the control / label / description / error ids derive. */
  id: string
  invalid: boolean
  required: boolean
  disabled: boolean
  readonly: boolean
  touched: boolean
}

export type FieldMsg =
  /** @intent("Mark the field as valid or invalid (drives aria-invalid + the error region)") */
  | { type: 'setInvalid'; invalid: boolean }
  /** @intent("Mark the field as required or optional") */
  | { type: 'setRequired'; required: boolean }
  /** @intent("Enable or disable the field's control") */
  | { type: 'setDisabled'; disabled: boolean }
  /** @intent("Make the field's control read-only or editable") */
  | { type: 'setReadonly'; readonly: boolean }
  /** @intent("Mark the field as touched (typically after first blur)") */
  | { type: 'setTouched'; touched: boolean }

export interface FieldInit {
  id: string
  invalid?: boolean
  required?: boolean
  disabled?: boolean
  readonly?: boolean
  touched?: boolean
}

export function init(opts: FieldInit): FieldState {
  return {
    id: opts.id,
    invalid: opts.invalid ?? false,
    required: opts.required ?? false,
    disabled: opts.disabled ?? false,
    readonly: opts.readonly ?? false,
    touched: opts.touched ?? false,
  }
}

export function update(state: FieldState, msg: FieldMsg): [FieldState, never[]] {
  switch (msg.type) {
    case 'setInvalid':
      return [{ ...state, invalid: msg.invalid }, []]
    case 'setRequired':
      return [{ ...state, required: msg.required }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
    case 'setReadonly':
      return [{ ...state, readonly: msg.readonly }, []]
    case 'setTouched':
      return [{ ...state, touched: msg.touched }, []]
  }
}

export interface FieldParts {
  /** The field wrapper. */
  root: {
    'data-scope': 'field'
    'data-part': 'root'
    'data-invalid': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
  }
  /** The `<label>`. `htmlFor` focuses the control on click. */
  label: {
    id: string
    htmlFor: string
    'data-scope': 'field'
    'data-part': 'label'
  }
  /** Spread onto the input/select/textarea (or a custom control via aria-labelledby). */
  control: {
    id: string
    'aria-labelledby': string
    'aria-describedby': Signal<string | undefined>
    'aria-invalid': Signal<'true' | undefined>
    'aria-required': Signal<'true' | undefined>
    disabled: Signal<boolean>
    readOnly: Signal<boolean>
    'data-scope': 'field'
    'data-part': 'control'
    onBlur: (e: FocusEvent) => void
  }
  /** The description / hint text. Render it only when there is a description to show. */
  description: {
    id: string
    'data-scope': 'field'
    'data-part': 'description'
  }
  /** The error message — a polite live region, intended to be rendered only while invalid. */
  errorText: {
    id: string
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'field'
    'data-part': 'error'
  }
}

export interface FieldConnectOptions {
  /** Base id; if omitted, falls back to the id stored in state. */
  id?: string
  /**
   * Whether a description element is rendered. When true, the description id is
   * always present in `aria-describedby`; when false it is omitted entirely.
   */
  hasDescription?: boolean
}

export function connect(
  state: Signal<FieldState>,
  send: Send<FieldMsg>,
  opts: FieldConnectOptions = {},
): FieldParts {
  const base = opts.id ?? state.peek().id
  const controlId = `${base}:control`
  const labelId = `${base}:label`
  const descriptionId = `${base}:description`
  const errorId = `${base}:error`
  const hasDescription = opts.hasDescription ?? false

  return {
    root: {
      'data-scope': 'field',
      'data-part': 'root',
      'data-invalid': state.map((s) => (s.invalid ? '' : undefined)),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    label: {
      id: labelId,
      htmlFor: controlId,
      'data-scope': 'field',
      'data-part': 'label',
    },
    control: {
      id: controlId,
      'aria-labelledby': labelId,
      'aria-describedby': state.map((s) => {
        const ids: string[] = []
        if (hasDescription) ids.push(descriptionId)
        if (s.invalid) ids.push(errorId)
        return ids.length > 0 ? ids.join(' ') : undefined
      }),
      'aria-invalid': state.map((s) => (s.invalid ? 'true' : undefined)),
      'aria-required': state.map((s) => (s.required ? 'true' : undefined)),
      disabled: state.map((s) => s.disabled),
      readOnly: state.map((s) => s.readonly),
      'data-scope': 'field',
      'data-part': 'control',
      onBlur: tagSend(send, ['setTouched'], () => send({ type: 'setTouched', touched: true })),
    },
    description: {
      id: descriptionId,
      'data-scope': 'field',
      'data-part': 'description',
    },
    errorText: {
      id: errorId,
      role: 'alert',
      'aria-live': 'polite',
      'data-scope': 'field',
      'data-part': 'error',
    },
  }
}

export const field = { init, update, connect }
