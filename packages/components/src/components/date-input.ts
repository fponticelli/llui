import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale'
import type { Locale } from '../locale'

/**
 * Date input — keyboard-only date field with masked parsing. Unlike
 * date-picker, this is a plain <input> that parses ISO-ish date strings
 * as the user types. Separate from date-picker to keep each focused.
 *
 * The machine holds the raw input string + the parsed Date (null until
 * a complete/valid value is entered). Min/max bounds are validated on
 * every change, populating `error` when out of range.
 */

export type DateError = 'invalid' | 'before-min' | 'after-max' | null

export interface DateInputState {
  /** Raw string as typed by the user. */
  input: string
  /** Parsed date, or null if the input is empty/invalid/out-of-range. */
  value: Date | null
  /** Optional lower bound (inclusive). */
  min: Date | null
  /** Optional upper bound (inclusive). */
  max: Date | null
  error: DateError
  disabled: boolean
  readOnly: boolean
  required: boolean
}

export type DateInputMsg =
  | { type: 'setInput'; value: string }
  | { type: 'setValue'; value: Date | null }
  | { type: 'clear' }
  | { type: 'setMin'; min: Date | null }
  | { type: 'setMax'; max: Date | null }
  | { type: 'setDisabled'; disabled: boolean }

export interface DateInputInit {
  input?: string
  value?: Date | null
  min?: Date | null
  max?: Date | null
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
}

/**
 * Parse an ISO-ish date string. Accepts:
 *   - YYYY-MM-DD
 *   - YYYY/MM/DD
 *   - MM/DD/YYYY (US)
 *   - DD/MM/YYYY (EU)
 * Returns null for anything else.
 */
export function parseDate(input: string, format: 'iso' | 'us' | 'eu' = 'iso'): Date | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/[-/]/).map((p) => p.trim())
  if (parts.length !== 3) return null
  const nums = parts.map((p) => parseInt(p, 10))
  if (nums.some((n) => isNaN(n))) return null
  let year: number, month: number, day: number
  if (format === 'iso' || parts[0]!.length === 4) {
    ;[year, month, day] = nums as [number, number, number]
  } else if (format === 'us') {
    ;[month, day, year] = nums as [number, number, number]
  } else {
    ;[day, month, year] = nums as [number, number, number]
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return null
  const d = new Date(year, month - 1, day)
  // JS Date normalizes: new Date(2024, 1, 30) → March 1. Reject that.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null
  }
  return d
}

/** Format a Date as 'YYYY-MM-DD'. */
export function formatDate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, '0')
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

function validate(value: Date | null, min: Date | null, max: Date | null): DateError {
  if (value === null) return null
  if (min !== null && value < min) return 'before-min'
  if (max !== null && value > max) return 'after-max'
  return null
}

export function init(opts: DateInputInit = {}): DateInputState {
  const value = opts.value ?? null
  const input = opts.input ?? (value ? formatDate(value) : '')
  const min = opts.min ?? null
  const max = opts.max ?? null
  return {
    input,
    value,
    min,
    max,
    error: validate(value, min, max),
    disabled: opts.disabled ?? false,
    readOnly: opts.readOnly ?? false,
    required: opts.required ?? false,
  }
}

export function update(
  state: DateInputState,
  msg: DateInputMsg,
  format: 'iso' | 'us' | 'eu' = 'iso',
): [DateInputState, never[]] {
  if ((state.disabled || state.readOnly) && msg.type === 'setInput') return [state, []]
  switch (msg.type) {
    case 'setInput': {
      const parsed = parseDate(msg.value, format)
      const error: DateError = msg.value.trim()
        ? parsed === null
          ? 'invalid'
          : validate(parsed, state.min, state.max)
        : null
      return [{ ...state, input: msg.value, value: parsed, error }, []]
    }
    case 'setValue': {
      const input = msg.value ? formatDate(msg.value) : ''
      return [
        { ...state, input, value: msg.value, error: validate(msg.value, state.min, state.max) },
        [],
      ]
    }
    case 'clear':
      return [{ ...state, input: '', value: null, error: null }, []]
    case 'setMin':
      return [{ ...state, min: msg.min, error: validate(state.value, msg.min, state.max) }, []]
    case 'setMax':
      return [{ ...state, max: msg.max, error: validate(state.value, state.min, msg.max) }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

export interface DateInputParts<S> {
  root: {
    'data-scope': 'date-input'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    'data-invalid': (s: S) => '' | undefined
  }
  input: {
    type: 'text'
    inputMode: 'numeric'
    autoComplete: 'off'
    spellCheck: false
    value: (s: S) => string
    disabled: (s: S) => boolean
    readOnly: (s: S) => boolean
    required: (s: S) => boolean
    'aria-invalid': (s: S) => 'true' | undefined
    placeholder?: string
    'data-scope': 'date-input'
    'data-part': 'input'
    onInput: (e: Event) => void
    onBlur: (e: FocusEvent) => void
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'date-input'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  errorText: {
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'date-input'
    'data-part': 'error-text'
    hidden: (s: S) => boolean
  }
}

export interface ConnectOptions {
  placeholder?: string
  clearLabel?: string
}

export function connect<S>(
  get: (s: S) => DateInputState,
  send: Send<DateInputMsg>,
  opts: ConnectOptions = {},
): DateInputParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  return {
    root: {
      'data-scope': 'date-input',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-invalid': (s) => (get(s).error ? '' : undefined),
    },
    input: {
      type: 'text',
      inputMode: 'numeric',
      autoComplete: 'off',
      spellCheck: false,
      value: (s) => get(s).input,
      disabled: (s) => get(s).disabled,
      readOnly: (s) => get(s).readOnly,
      required: (s) => get(s).required,
      'aria-invalid': (s) => (get(s).error ? 'true' : undefined),
      ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
      'data-scope': 'date-input',
      'data-part': 'input',
      onInput: (e) => {
        const el = e.target as HTMLInputElement
        send({ type: 'setInput', value: el.value })
      },
      onBlur: () => {
        /* consumers can add their own blur handling */
      },
    },
    clearTrigger: {
      type: 'button',
      'aria-label': opts.clearLabel ?? ((s: S) => locale(s).dateInput.clear),
      disabled: (s) => get(s).input === '',
      'data-scope': 'date-input',
      'data-part': 'clear-trigger',
      onClick: () => send({ type: 'clear' }),
    },
    errorText: {
      role: 'alert',
      'aria-live': 'polite',
      'data-scope': 'date-input',
      'data-part': 'error-text',
      hidden: (s) => get(s).error === null,
    },
  }
}

export const dateInput = { init, update, connect, parseDate, formatDate }
