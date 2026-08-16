import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { dateInputLocale } from '../locale/date-input.js'

/**
 * Date input — keyboard-only date field with masked parsing. Unlike
 * date-picker, this is a plain <input> that parses ISO-ish date strings
 * as the user types. Separate from date-picker to keep each focused.
 *
 * The machine holds the raw input string + the parsed date as an ISO
 * `YYYY-MM-DD` string (null until a complete/valid value is entered) —
 * never a `Date`, so the state stays JSON-serializable like date-picker's
 * (#119). Min/max bounds are validated on every change, populating `error`
 * when out of range, and an unparseable `value` — from `init` or `setValue`
 * alike — sets `error: 'invalid'` rather than vanishing.
 */

export type DateError = 'invalid' | 'before-min' | 'after-max' | null

/** A calendar date as `YYYY-MM-DD`. Zero-padded, so plain `<`/`>` order it. */
export type IsoDate = string

export interface DateInputState {
  /** Raw string as typed by the user. */
  input: string
  /** Parsed date as `YYYY-MM-DD`, or null if empty/invalid. */
  value: IsoDate | null
  /** Optional lower bound (inclusive), `YYYY-MM-DD`. */
  min: IsoDate | null
  /** Optional upper bound (inclusive), `YYYY-MM-DD`. */
  max: IsoDate | null
  error: DateError
  disabled: boolean
  readonly: boolean
  required: boolean
}

export type DateInputMsg =
  /** @intent("Update the raw text the user has typed (re-parses to a date)") */
  | { type: 'setInput'; value: string }
  /** @intent("Set the parsed date directly as YYYY-MM-DD (also updates the displayed text)") */
  | { type: 'setValue'; value: IsoDate | null }
  /** @intent("Clear the input and the parsed date") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'setMin'; min: IsoDate | null }
  /** @humanOnly */
  | { type: 'setMax'; max: IsoDate | null }
  /** @humanOnly */
  | { type: 'setDisabled'; disabled: boolean }

export interface DateInputInit {
  input?: string
  value?: IsoDate | null
  min?: IsoDate | null
  max?: IsoDate | null
  disabled?: boolean
  readonly?: boolean
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

/**
 * Parse into the canonical `YYYY-MM-DD` form, or null when unparseable.
 * Everything that reaches state goes through here, so the comparisons in
 * `validate` can rely on zero-padded lexicographic order.
 */
export function toIsoDate(input: string, format: 'iso' | 'us' | 'eu' = 'iso'): IsoDate | null {
  const d = parseDate(input, format)
  return d === null ? null : formatDate(d)
}

function validate(value: IsoDate | null, min: IsoDate | null, max: IsoDate | null): DateError {
  if (value === null) return null
  // Zero-padded YYYY-MM-DD sorts chronologically as a plain string.
  if (min !== null && value < min) return 'before-min'
  if (max !== null && value > max) return 'after-max'
  return null
}

export function init(opts: DateInputInit = {}): DateInputState {
  const requested = opts.value ?? null
  const value = requested === null ? null : toIsoDate(requested)
  // An unparseable init value used to vanish silently — `{ value: null,
  // input: '', error: null }`, indistinguishable from an empty field. That was
  // unrepresentable while `value` was a `Date`; as an ISO string it is
  // representable, so it is REPORTED, exactly as `setValue` reports it
  // (#138 review, item 12). The rejected text is kept as the displayed input so
  // the field shows what the host asked for.
  const invalidValue = requested !== null && value === null
  const input = opts.input ?? (invalidValue ? requested : (value ?? ''))
  const min = opts.min != null ? toIsoDate(opts.min) : null
  const max = opts.max != null ? toIsoDate(opts.max) : null
  return {
    input,
    value,
    min,
    max,
    error: invalidValue ? 'invalid' : validate(value, min, max),
    disabled: opts.disabled ?? false,
    readonly: opts.readonly ?? false,
    required: opts.required ?? false,
  }
}

export function update(
  state: DateInputState,
  msg: DateInputMsg,
  format: 'iso' | 'us' | 'eu' = 'iso',
): [DateInputState, never[]] {
  if ((state.disabled || state.readonly) && msg.type === 'setInput') return [state, []]
  switch (msg.type) {
    case 'setInput': {
      const parsed = toIsoDate(msg.value, format)
      const error: DateError = msg.value.trim()
        ? parsed === null
          ? 'invalid'
          : validate(parsed, state.min, state.max)
        : null
      return [{ ...state, input: msg.value, value: parsed, error }, []]
    }
    case 'setValue': {
      // The wire form is always ISO, whatever `format` the user types in.
      const parsed = msg.value === null ? null : toIsoDate(msg.value)
      if (msg.value !== null && parsed === null) {
        return [{ ...state, input: msg.value, value: null, error: 'invalid' }, []]
      }
      return [
        {
          ...state,
          input: parsed ?? '',
          value: parsed,
          error: validate(parsed, state.min, state.max),
        },
        [],
      ]
    }
    case 'clear':
      return [{ ...state, input: '', value: null, error: null }, []]
    case 'setMin': {
      const min = msg.min === null ? null : toIsoDate(msg.min)
      return [{ ...state, min, error: validate(state.value, min, state.max) }, []]
    }
    case 'setMax': {
      const max = msg.max === null ? null : toIsoDate(msg.max)
      return [{ ...state, max, error: validate(state.value, state.min, max) }, []]
    }
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

export interface DateInputParts {
  root: {
    'data-scope': 'date-input'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
    'data-invalid': Signal<'' | undefined>
  }
  input: {
    type: 'text'
    inputmode: 'numeric'
    autocomplete: 'off'
    spellcheck: false
    value: Signal<string>
    disabled: Signal<boolean>
    readonly: Signal<boolean>
    required: Signal<boolean>
    'aria-invalid': Signal<'true' | undefined>
    placeholder?: string
    'data-scope': 'date-input'
    'data-part': 'input'
    onInput: (e: Event) => void
    onBlur: (e: FocusEvent) => void
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'date-input'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  errorText: {
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'date-input'
    'data-part': 'error-text'
    hidden: Signal<boolean>
  }
}

export interface ConnectOptions {
  placeholder?: string
  clearLabel?: string
}

export function connect(
  state: Signal<DateInputState>,
  send: Send<DateInputMsg>,
  opts: ConnectOptions = {},
): DateInputParts {
  const locale = dateInputLocale()
  return {
    root: {
      'data-scope': 'date-input',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-invalid': state.map((s) => (s.error ? '' : undefined)),
    },
    input: {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      spellcheck: false,
      value: state.map((s) => s.input),
      disabled: state.map((s) => s.disabled),
      readonly: state.map((s) => s.readonly),
      required: state.map((s) => s.required),
      'aria-invalid': state.map((s) => (s.error ? 'true' : undefined)),
      ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
      'data-scope': 'date-input',
      'data-part': 'input',
      onInput: tagSend(send, ['setInput'], (e) => {
        const el = e.target as HTMLInputElement
        send({ type: 'setInput', value: el.value })
      }),
      onBlur: () => {
        /* consumers can add their own blur handling */
      },
    },
    clearTrigger: {
      type: 'button',
      'aria-label': opts.clearLabel ?? locale.clear,
      disabled: state.map((s) => s.input === ''),
      'data-scope': 'date-input',
      'data-part': 'clear-trigger',
      onClick: tagSend(send, ['clear'], () => send({ type: 'clear' })),
    },
    errorText: {
      role: 'alert',
      'aria-live': 'polite',
      'data-scope': 'date-input',
      'data-part': 'error-text',
      hidden: state.map((s) => s.error === null),
    },
  }
}

export const dateInput = { init, update, connect, parseDate, formatDate, toIsoDate }
