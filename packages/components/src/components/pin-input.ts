import { tagSend } from '@llui/dom/signals'
import type { Send, Signal } from '@llui/dom/signals'
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

export interface PinInputParts {
  root: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': 'pin-input'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  label: {
    id: string
    'data-scope': 'pin-input'
    'data-part': 'label'
  }
  /** Props for the input at a given index. */
  input: (index: number) => {
    type: Signal<'text' | 'password'>
    inputMode: Signal<'numeric' | 'text'>
    pattern: Signal<string>
    maxLength: 1
    autoComplete: 'off'
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
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

export function connect(
  state: Signal<PinInputState>,
  send: Send<PinInputMsg>,
  opts: ConnectOptions,
): PinInputParts {
  const labelId = `${opts.id}:label`
  const inputLabel = opts.inputLabel ?? en.pinInput.input
  const validate = opts.validate

  return {
    root: {
      role: 'group',
      'aria-labelledby': labelId,
      'data-scope': 'pin-input',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    label: {
      id: labelId,
      'data-scope': 'pin-input',
      'data-part': 'label',
    },
    input: (index: number) => ({
      type: state.map((s) => (s.mask ? 'password' : 'text')),
      inputMode: state.map((s) => (s.type === 'numeric' ? 'numeric' : 'text')),
      pattern: state.map((s) => {
        switch (s.type) {
          case 'numeric':
            return '[0-9]*'
          case 'alphabetic':
            return '[a-zA-Z]*'
          case 'alphanumeric':
            return '[a-zA-Z0-9]*'
        }
      }),
      maxLength: 1,
      autoComplete: 'off',
      'aria-label': inputLabel(index),
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => s.values[index] ?? ''),
      'data-scope': 'pin-input',
      'data-part': 'input',
      'data-index': String(index),
      onInput: tagSend(send, ['setValue'], (e) => {
        const value = (e.target as HTMLInputElement).value
        if (validate && value !== '') {
          const errors = validate(value.slice(-1))
          if (errors && errors.length > 0) return
        }
        send({ type: 'setValue', index, value })
      }),
      onKeyDown: tagSend(send, ['backspace', 'focus'], (e) => {
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
      }),
      onFocus: tagSend(send, ['focus'], () => send({ type: 'focus', index })),
      onPaste: tagSend(send, ['setAll'], (e) => {
        e.preventDefault()
        const text = e.clipboardData?.getData('text') ?? ''
        send({ type: 'setAll', values: text.split('') })
      }),
    }),
  }
}

export const pinInput = { init, update, connect, isComplete, getValue }
