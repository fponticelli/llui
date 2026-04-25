import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { en } from '../locale.js'

/**
 * Pin input — a sequence of single-character fields for OTP codes, etc.
 * Auto-advances on input, handles backspace to previous field, supports
 * paste-to-fill across multiple fields.
 */

export type PinType = 'numeric' | 'alphanumeric' | 'alphabetic'

export interface PinInputState {
  values: string[]
  length: number
  type: PinType
  mask: boolean
  disabled: boolean
  focusedIndex: number
}

export type PinInputMsg =
  /** @intent("Set the character at a given field index (auto-advances focus on accept)") */
  | { type: 'setValue'; index: number; value: string }
  /** @intent("Replace every field at once (typically from paste)") */
  | { type: 'setAll'; values: string[] }
  /** @humanOnly */
  | { type: 'focus'; index: number }
  /** @intent("Clear every field") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'backspace'; index: number }

export interface PinInputInit {
  length?: number
  type?: PinType
  mask?: boolean
  disabled?: boolean
  values?: string[]
}

export function init(opts: PinInputInit = {}): PinInputState {
  const length = opts.length ?? 4
  const values = opts.values ?? new Array<string>(length).fill('')
  return {
    values,
    length,
    type: opts.type ?? 'numeric',
    mask: opts.mask ?? false,
    disabled: opts.disabled ?? false,
    focusedIndex: 0,
  }
}

function sanitize(char: string, type: PinType): string {
  if (char.length !== 1) return ''
  if (type === 'numeric' && !/\d/.test(char)) return ''
  if (type === 'alphabetic' && !/[a-zA-Z]/.test(char)) return ''
  if (type === 'alphanumeric' && !/[a-zA-Z0-9]/.test(char)) return ''
  return char
}

export function update(state: PinInputState, msg: PinInputMsg): [PinInputState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setValue': {
      const char = sanitize(msg.value.slice(-1), state.type)
      if (!char && msg.value !== '') return [state, []]
      const values = [...state.values]
      values[msg.index] = char
      // Auto-advance
      const nextIndex = char ? Math.min(msg.index + 1, state.length - 1) : msg.index
      return [{ ...state, values, focusedIndex: nextIndex }, []]
    }
    case 'setAll': {
      const values = new Array<string>(state.length).fill('')
      for (let i = 0; i < Math.min(msg.values.length, state.length); i++) {
        values[i] = sanitize(msg.values[i]!, state.type)
      }
      const lastFilled = values.findIndex((v) => v === '')
      const focusedIndex = lastFilled === -1 ? state.length - 1 : lastFilled
      return [{ ...state, values, focusedIndex }, []]
    }
    case 'focus':
      return [{ ...state, focusedIndex: Math.max(0, Math.min(msg.index, state.length - 1)) }, []]
    case 'clear':
      return [{ ...state, values: new Array<string>(state.length).fill(''), focusedIndex: 0 }, []]
    case 'backspace': {
      const values = [...state.values]
      if (values[msg.index]) {
        values[msg.index] = ''
        return [{ ...state, values }, []]
      }
      // Field is empty — move focus back and clear prior
      const prev = Math.max(0, msg.index - 1)
      values[prev] = ''
      return [{ ...state, values, focusedIndex: prev }, []]
    }
  }
}

export function isComplete(state: PinInputState): boolean {
  return state.values.every((v) => v !== '')
}

export function getValue(state: PinInputState): string {
  return state.values.join('')
}

export interface PinInputParts<S> {
  root: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': 'pin-input'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
  }
  label: {
    id: string
    'data-scope': 'pin-input'
    'data-part': 'label'
  }
  /** Props for the input at a given index. */
  input: (index: number) => {
    type: (s: S) => 'text' | 'password'
    inputMode: (s: S) => 'numeric' | 'text'
    pattern: (s: S) => string
    maxLength: 1
    autoComplete: 'off'
    'aria-label': string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'pin-input'
    'data-part': 'input'
    'data-index': string
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
    onPaste: (e: ClipboardEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  inputLabel?: (index: number) => string
  /** Validate each character before setting. Non-empty array blocks setDigit. */
  validate?: (value: string) => string[] | null
}

export function connect<S>(
  get: (s: S) => PinInputState,
  send: Send<PinInputMsg>,
  opts: ConnectOptions,
): PinInputParts<S> {
  const labelId = `${opts.id}:label`
  const inputLabel = opts.inputLabel ?? en.pinInput.input
  const validate = opts.validate

  return {
    root: {
      role: 'group',
      'aria-labelledby': labelId,
      'data-scope': 'pin-input',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    label: {
      id: labelId,
      'data-scope': 'pin-input',
      'data-part': 'label',
    },
    input: (index: number) => ({
      type: (s) => (get(s).mask ? 'password' : 'text'),
      inputMode: (s) => (get(s).type === 'numeric' ? 'numeric' : 'text'),
      pattern: (s) => {
        switch (get(s).type) {
          case 'numeric':
            return '[0-9]*'
          case 'alphabetic':
            return '[a-zA-Z]*'
          case 'alphanumeric':
            return '[a-zA-Z0-9]*'
        }
      },
      maxLength: 1,
      autoComplete: 'off',
      'aria-label': inputLabel(index),
      disabled: (s) => get(s).disabled,
      value: (s) => get(s).values[index] ?? '',
      'data-scope': 'pin-input',
      'data-part': 'input',
      'data-index': String(index),
      onInput: (e) => {
        const value = (e.target as HTMLInputElement).value
        if (validate && value !== '') {
          const errors = validate(value.slice(-1))
          if (errors && errors.length > 0) return
        }
        send({ type: 'setValue', index, value })
      },
      onKeyDown: (e) => {
        const key = flipArrow(e.key, e.currentTarget as Element)
        if (key === 'Backspace') {
          send({ type: 'backspace', index })
        } else if (key === 'ArrowLeft') {
          e.preventDefault()
          send({ type: 'focus', index: index - 1 })
        } else if (key === 'ArrowRight') {
          e.preventDefault()
          send({ type: 'focus', index: index + 1 })
        }
      },
      onFocus: () => send({ type: 'focus', index }),
      onPaste: (e) => {
        e.preventDefault()
        const text = e.clipboardData?.getData('text') ?? ''
        send({ type: 'setAll', values: text.split('') })
      },
    }),
  }
}

export const pinInput = { init, update, connect, isComplete, getValue }
