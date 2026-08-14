import { tagSend, useContext } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { focusRovingItem } from '../utils/roving.js'
import { LocaleContext } from '../locale.js'

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

/**
 * Accepted characters of a pasted sequence, in order and WITHOUT the holes a
 * rejected character used to leave. Sanitizing per SLOT dropped '123-456' into
 * ['1','2','3','','4','5'] — the separator ate a slot and the last digit fell
 * off the end (#125). Entries may hold more than one character — the paste
 * handler passes the clipboard text WHOLE, which is what makes the code-point
 * iteration below reachable: a surrogate pair is judged (and rejected) as ONE
 * character rather than as two lone halves. Splitting by UTF-16 code unit
 * before the call throws that away, which is what the caller used to do.
 */
export function acceptedChars(values: readonly string[], type: PinType): string[] {
  const accepted: string[] = []
  for (const entry of values) {
    for (const char of entry) {
      const sanitized = sanitize(char, type)
      if (sanitized) accepted.push(sanitized)
    }
  }
  return accepted
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
      const accepted = acceptedChars(msg.values, state.type)
      const values = new Array<string>(state.length).fill('')
      for (let i = 0; i < Math.min(accepted.length, state.length); i++) {
        values[i] = accepted[i]!
      }
      const firstEmpty = values.findIndex((v) => v === '')
      const focusedIndex = firstEmpty === -1 ? state.length - 1 : firstEmpty
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
    inputmode: Signal<'numeric' | 'text'>
    pattern: Signal<string>
    maxlength: 1
    autocomplete: 'off'
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
  const locale = useContext(LocaleContext)
  const inputLabel = opts.inputLabel ?? locale.pinInput.input
  const validate = opts.validate

  // Move real DOM focus to the field the reducer just made active. Roving
  // focus lives in `focusedIndex`; without this, auto-advance and arrow keys
  // never move the caret (silent for AT, and typing stalls on one field).
  const moveFocus = (origin: Element | null): void => {
    const s = state.peek()
    if (s == null) return
    focusRovingItem(origin, 'pin-input', String(s.focusedIndex), {
      itemPart: 'input',
      attr: 'data-index',
    })
  }

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
      inputmode: state.map((s) => (s.type === 'numeric' ? 'numeric' : 'text')),
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
      maxlength: 1,
      autocomplete: 'off',
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
        // Auto-advance: move DOM focus to the field the reducer advanced to.
        moveFocus(e.currentTarget as Element | null)
      }),
      onKeyDown: tagSend(send, ['backspace', 'focus'], (e) => {
        const origin = e.currentTarget as Element | null
        const key = flipArrow(e.key, e.currentTarget as Element)
        if (key === 'Backspace') {
          send({ type: 'backspace', index })
          moveFocus(origin)
        } else if (key === 'ArrowLeft') {
          e.preventDefault()
          send({ type: 'focus', index: index - 1 })
          moveFocus(origin)
        } else if (key === 'ArrowRight') {
          e.preventDefault()
          send({ type: 'focus', index: index + 1 })
          moveFocus(origin)
        }
      }),
      onFocus: tagSend(send, ['focus'], () => send({ type: 'focus', index })),
      onPaste: tagSend(send, ['setAll'], (e) => {
        e.preventDefault()
        const text = e.clipboardData?.getData('text') ?? ''
        // Hand the clipboard text over WHOLE. `acceptedChars` iterates an entry
        // by CODE POINT; `text.split('')` splits by UTF-16 code UNIT, so a
        // pasted surrogate pair arrived as two lone halves and the code-point
        // guarantee never reached the only caller that needed it.
        send({ type: 'setAll', values: [text] })
      }),
    }),
  }
}

export const pinInput = { init, update, connect, isComplete, getValue, acceptedChars }
