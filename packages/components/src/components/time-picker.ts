import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { finiteBound } from '../utils/number.js'

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
  /** @intent("Set the full time value (hours/minutes/seconds)") */
  | { type: 'setValue'; value: TimeValue }
  /** @intent("Set the hours field directly — 0-23 in 24-hour format, 1-12 in 12-hour format where the current AM/PM is kept") */
  | { type: 'setHours'; hours: number }
  /** @intent("Set the minutes field directly") */
  | { type: 'setMinutes'; minutes: number }
  /** @intent("Set the seconds field directly") */
  | { type: 'setSeconds'; seconds: number }
  /** @intent("Bump hours up by 1 (wraps at 24/12). Ignored while disabled") */
  | { type: 'incrementHours' }
  /** @intent("Bump hours down by 1. Ignored while disabled") */
  | { type: 'decrementHours' }
  /** @intent("Bump minutes up by minuteStep. Ignored while disabled") */
  | { type: 'incrementMinutes' }
  /** @intent("Bump minutes down by minuteStep. Ignored while disabled") */
  | { type: 'decrementMinutes' }
  /** @intent("Flip between AM and PM (12-hour format only). Ignored while disabled") */
  | { type: 'toggleAmPm' }
  /** @intent("Enable or disable the time-picker — a host/agent write, never gated") */
  | { type: 'setDisabled'; disabled: boolean }

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
    // The increments every arrow/wheel adjustment is quantised by (#177).
    minuteStep: finiteBound(opts.minuteStep) ?? 1,
    secondStep: finiteBound(opts.secondStep) ?? 1,
    showSeconds: opts.showSeconds ?? false,
    disabled: opts.disabled ?? false,
  }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/**
 * Messages a disabled time-picker still accepts. `disabled` gates HUMAN
 * interaction — the stepper buttons and the AM/PM toggle — not the host's or an
 * agent's programmatic writes. The gate used to swallow EVERYTHING, and with no
 * `setDisabled` at all a disabled instance could never be re-enabled (#120). *
 * This allow-list and the `@intent`/`@humanOnly` JSDoc on the Msg union answer
 * DIFFERENT questions — "does this survive the gate" versus "may an agent
 * dispatch it at all" — and they must not contradict each other: every message
 * named here is agent-dispatchable, and every gated variant an agent may still
 * send says so in its `@intent` text instead of promising a write the gate
 * swallows. `test/disabled-gate-annotations.test.ts` fails the build if the two
 * drift apart (#138 review).
 */
const PROGRAMMATIC: ReadonlySet<TimePickerMsg['type']> = new Set([
  'setValue',
  'setHours',
  'setMinutes',
  'setSeconds',
  'setDisabled',
])

export function update(state: TimePickerState, msg: TimePickerMsg): [TimePickerState, never[]] {
  if (state.disabled && !PROGRAMMATIC.has(msg.type)) return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setHours':
      return [
        { ...state, value: { ...state.value, hours: hoursFromDisplay(msg.hours, state) } },
        [],
      ]
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
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

/** Hours formatted for display (12-hr: 1..12, 24-hr: 0..23). */
export function displayHours(state: TimePickerState): number {
  if (state.format === '24') return state.value.hours
  const h = state.value.hours % 12
  return h === 0 ? 12 : h
}

/**
 * Inverse of `displayHours`: turn a value from the hours FIELD into the stored
 * 24-hour value. In 12-hour format the field reads 1..12, so it only says which
 * hour of the half-day — the meridiem has to come from the current value. The
 * single mutation path used `mod(hours, 24)` instead, so typing "3" at 15:00
 * stored 03:00 and silently flipped PM to AM (#125).
 */
export function hoursFromDisplay(hours: number, state: TimePickerState): number {
  if (state.format === '24') return mod(hours, 24)
  const half = mod(hours, 12) // 12 o'clock is the 0th hour of its half-day
  return period(state) === 'PM' ? half + 12 : half
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

export interface TimePickerParts {
  root: {
    role: 'group'
    'aria-label': string
    'data-scope': 'time-picker'
    'data-part': 'root'
    'data-format': Signal<TimeFormat>
  }
  hoursInput: {
    type: 'number'
    role: 'spinbutton'
    'aria-label': string
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number>
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'time-picker'
    'data-part': 'hours-input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  minutesInput: {
    type: 'number'
    role: 'spinbutton'
    'aria-label': string
    'aria-valuemin': 0
    'aria-valuemax': 59
    'aria-valuenow': Signal<number>
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'time-picker'
    'data-part': 'minutes-input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  periodTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'time-picker'
    'data-part': 'period-trigger'
    'data-period': Signal<'AM' | 'PM'>
    onClick: (e: MouseEvent) => void
    hidden: Signal<boolean>
  }
}

export interface ConnectOptions {
  label?: string
  hoursLabel?: string
  minutesLabel?: string
  periodLabel?: string
}

export function connect(
  state: Signal<TimePickerState>,
  send: Send<TimePickerMsg>,
  opts: ConnectOptions = {},
): TimePickerParts {
  const locale = useContext(LocaleContext)
  return {
    root: {
      role: 'group',
      'aria-label': opts.label ?? locale.timePicker.label,
      'data-scope': 'time-picker',
      'data-part': 'root',
      'data-format': state.map((s) => s.format),
    },
    hoursInput: {
      type: 'number',
      role: 'spinbutton',
      'aria-label': opts.hoursLabel ?? locale.timePicker.hours,
      'aria-valuemin': state.map((s) => (s.format === '12' ? 1 : 0)),
      'aria-valuemax': state.map((s) => (s.format === '12' ? 12 : 23)),
      'aria-valuenow': state.map((s) => displayHours(s)),
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(displayHours(s)).padStart(2, '0')),
      'data-scope': 'time-picker',
      'data-part': 'hours-input',
      onInput: tagSend(send, ['setHours'], (e) => {
        const n = parseInt((e.target as HTMLInputElement).value, 10)
        if (!isNaN(n)) send({ type: 'setHours', hours: n })
      }),
      onKeyDown: tagSend(send, ['incrementHours', 'decrementHours'], (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          send({ type: 'incrementHours' })
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          send({ type: 'decrementHours' })
        }
      }),
    },
    minutesInput: {
      type: 'number',
      role: 'spinbutton',
      'aria-label': opts.minutesLabel ?? locale.timePicker.minutes,
      'aria-valuemin': 0,
      'aria-valuemax': 59,
      'aria-valuenow': state.map((s) => s.value.minutes),
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(s.value.minutes).padStart(2, '0')),
      'data-scope': 'time-picker',
      'data-part': 'minutes-input',
      onInput: tagSend(send, ['setMinutes'], (e) => {
        const n = parseInt((e.target as HTMLInputElement).value, 10)
        if (!isNaN(n)) send({ type: 'setMinutes', minutes: n })
      }),
      onKeyDown: tagSend(send, ['incrementMinutes', 'decrementMinutes'], (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          send({ type: 'incrementMinutes' })
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          send({ type: 'decrementMinutes' })
        }
      }),
    },
    periodTrigger: {
      type: 'button',
      'aria-label': opts.periodLabel ?? locale.timePicker.period,
      disabled: state.map((s) => s.disabled),
      'data-scope': 'time-picker',
      'data-part': 'period-trigger',
      'data-period': state.map((s) => period(s)),
      onClick: tagSend(send, ['toggleAmPm'], () => send({ type: 'toggleAmPm' })),
      hidden: state.map((s) => s.format === '24'),
    },
  }
}

export const timePicker = {
  init,
  update,
  connect,
  displayHours,
  hoursFromDisplay,
  period,
  formatTime,
}
