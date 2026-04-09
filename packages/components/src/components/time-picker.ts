import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale'
import type { Locale } from '../locale'

/**
 * Time picker — hours and minutes input with increment/decrement buttons.
 * 12 or 24-hour format; optional seconds; step for minutes/seconds.
 */

export type TimeFormat = '12' | '24'

export interface TimeValue {
  hours: number
  minutes: number
  seconds: number
}

export interface TimePickerState {
  value: TimeValue
  format: TimeFormat
  minuteStep: number
  secondStep: number
  showSeconds: boolean
  disabled: boolean
}

export type TimePickerMsg =
  | { type: 'setValue'; value: TimeValue }
  | { type: 'setHours'; hours: number }
  | { type: 'setMinutes'; minutes: number }
  | { type: 'setSeconds'; seconds: number }
  | { type: 'incrementHours' }
  | { type: 'decrementHours' }
  | { type: 'incrementMinutes' }
  | { type: 'decrementMinutes' }
  | { type: 'toggleAmPm' }

export interface TimePickerInit {
  value?: TimeValue
  format?: TimeFormat
  minuteStep?: number
  secondStep?: number
  showSeconds?: boolean
  disabled?: boolean
}

export function init(opts: TimePickerInit = {}): TimePickerState {
  return {
    value: opts.value ?? { hours: 0, minutes: 0, seconds: 0 },
    format: opts.format ?? '24',
    minuteStep: opts.minuteStep ?? 1,
    secondStep: opts.secondStep ?? 1,
    showSeconds: opts.showSeconds ?? false,
    disabled: opts.disabled ?? false,
  }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

export function update(state: TimePickerState, msg: TimePickerMsg): [TimePickerState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setHours':
      return [{ ...state, value: { ...state.value, hours: mod(msg.hours, 24) } }, []]
    case 'setMinutes':
      return [{ ...state, value: { ...state.value, minutes: mod(msg.minutes, 60) } }, []]
    case 'setSeconds':
      return [{ ...state, value: { ...state.value, seconds: mod(msg.seconds, 60) } }, []]
    case 'incrementHours':
      return [{ ...state, value: { ...state.value, hours: mod(state.value.hours + 1, 24) } }, []]
    case 'decrementHours':
      return [{ ...state, value: { ...state.value, hours: mod(state.value.hours - 1, 24) } }, []]
    case 'incrementMinutes':
      return [
        {
          ...state,
          value: { ...state.value, minutes: mod(state.value.minutes + state.minuteStep, 60) },
        },
        [],
      ]
    case 'decrementMinutes':
      return [
        {
          ...state,
          value: { ...state.value, minutes: mod(state.value.minutes - state.minuteStep, 60) },
        },
        [],
      ]
    case 'toggleAmPm': {
      const h = state.value.hours >= 12 ? state.value.hours - 12 : state.value.hours + 12
      return [{ ...state, value: { ...state.value, hours: h } }, []]
    }
  }
}

/** Hours formatted for display (12-hr: 1..12, 24-hr: 0..23). */
export function displayHours(state: TimePickerState): number {
  if (state.format === '24') return state.value.hours
  const h = state.value.hours % 12
  return h === 0 ? 12 : h
}

/** AM or PM for 12-hour format. */
export function period(state: TimePickerState): 'AM' | 'PM' {
  return state.value.hours >= 12 ? 'PM' : 'AM'
}

/** Format the full time string (HH:MM or HH:MM:SS). */
export function formatTime(state: TimePickerState): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const h = pad(state.value.hours)
  const m = pad(state.value.minutes)
  if (state.showSeconds) return `${h}:${m}:${pad(state.value.seconds)}`
  return `${h}:${m}`
}

export interface TimePickerParts<S> {
  root: {
    role: 'group'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'time-picker'
    'data-part': 'root'
    'data-format': (s: S) => TimeFormat
  }
  hoursInput: {
    type: 'number'
    role: 'spinbutton'
    'aria-label': string | ((s: S) => string)
    'aria-valuemin': (s: S) => number
    'aria-valuemax': (s: S) => number
    'aria-valuenow': (s: S) => number
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'time-picker'
    'data-part': 'hours-input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  minutesInput: {
    type: 'number'
    role: 'spinbutton'
    'aria-label': string | ((s: S) => string)
    'aria-valuemin': 0
    'aria-valuemax': 59
    'aria-valuenow': (s: S) => number
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'time-picker'
    'data-part': 'minutes-input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  periodTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'time-picker'
    'data-part': 'period-trigger'
    'data-period': (s: S) => 'AM' | 'PM'
    onClick: (e: MouseEvent) => void
    hidden: (s: S) => boolean
  }
}

export interface ConnectOptions {
  label?: string
  hoursLabel?: string
  minutesLabel?: string
  periodLabel?: string
}

export function connect<S>(
  get: (s: S) => TimePickerState,
  send: Send<TimePickerMsg>,
  opts: ConnectOptions = {},
): TimePickerParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  return {
    root: {
      role: 'group',
      'aria-label': opts.label ?? ((s: S) => locale(s).timePicker.label),
      'data-scope': 'time-picker',
      'data-part': 'root',
      'data-format': (s) => get(s).format,
    },
    hoursInput: {
      type: 'number',
      role: 'spinbutton',
      'aria-label': opts.hoursLabel ?? ((s: S) => locale(s).timePicker.hours),
      'aria-valuemin': (s) => (get(s).format === '12' ? 1 : 0),
      'aria-valuemax': (s) => (get(s).format === '12' ? 12 : 23),
      'aria-valuenow': (s) => displayHours(get(s)),
      disabled: (s) => get(s).disabled,
      value: (s) => String(displayHours(get(s))).padStart(2, '0'),
      'data-scope': 'time-picker',
      'data-part': 'hours-input',
      onInput: (e) => {
        const n = parseInt((e.target as HTMLInputElement).value, 10)
        if (!isNaN(n)) send({ type: 'setHours', hours: n })
      },
      onKeyDown: (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          send({ type: 'incrementHours' })
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          send({ type: 'decrementHours' })
        }
      },
    },
    minutesInput: {
      type: 'number',
      role: 'spinbutton',
      'aria-label': opts.minutesLabel ?? ((s: S) => locale(s).timePicker.minutes),
      'aria-valuemin': 0,
      'aria-valuemax': 59,
      'aria-valuenow': (s) => get(s).value.minutes,
      disabled: (s) => get(s).disabled,
      value: (s) => String(get(s).value.minutes).padStart(2, '0'),
      'data-scope': 'time-picker',
      'data-part': 'minutes-input',
      onInput: (e) => {
        const n = parseInt((e.target as HTMLInputElement).value, 10)
        if (!isNaN(n)) send({ type: 'setMinutes', minutes: n })
      },
      onKeyDown: (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          send({ type: 'incrementMinutes' })
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          send({ type: 'decrementMinutes' })
        }
      },
    },
    periodTrigger: {
      type: 'button',
      'aria-label': opts.periodLabel ?? ((s: S) => locale(s).timePicker.period),
      disabled: (s) => get(s).disabled,
      'data-scope': 'time-picker',
      'data-part': 'period-trigger',
      'data-period': (s) => period(get(s)),
      onClick: () => send({ type: 'toggleAmPm' }),
      hidden: (s) => get(s).format === '24',
    },
  }
}

export const timePicker = { init, update, connect, displayHours, period, formatTime }
