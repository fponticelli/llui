import type { Send, Signal } from '@llui/dom/signals'
import { useContext, tagSend } from '@llui/dom/signals'
import { LocaleContext } from '../locale.js'

/**
 * Number input — numeric field with increment/decrement buttons. Clamps
 * to min/max and snaps to step. Keyboard: Arrow Up/Down, PageUp/PageDown,
 * Home/End.
 */

export interface NumberInputState {
  value: number | null
  min: number
  max: number
  step: number
  disabled: boolean
  readOnly: boolean
  /** Allow a free-text input value while the user is typing. */
  rawText: string
}

export type NumberInputMsg =
  /** @intent("Set the numeric value (clamped to min/max, snapped to step)") */
  | { type: 'setValue'; value: number | null }
  /** @humanOnly */
  | { type: 'setRawText'; text: string }
  /** @intent("Commit the in-progress text input — parse, clamp, snap, and update value") */
  | { type: 'commit' }
  /** @intent("Increase value by step (or step × multiplier)") */
  | { type: 'increment'; multiplier?: number }
  /** @intent("Decrease value by step (or step × multiplier)") */
  | { type: 'decrement'; multiplier?: number }
  /** @intent("Snap value to the configured minimum") */
  | { type: 'toMin' }
  /** @intent("Snap value to the configured maximum") */
  | { type: 'toMax' }
  /** @humanOnly */
  | { type: 'setDisabled'; disabled: boolean }

export interface NumberInputInit {
  value?: number | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  readOnly?: boolean
}

export function init(opts: NumberInputInit = {}): NumberInputState {
  const value = opts.value ?? null
  return {
    value,
    min: opts.min ?? -Infinity,
    max: opts.max ?? Infinity,
    step: opts.step ?? 1,
    disabled: opts.disabled ?? false,
    readOnly: opts.readOnly ?? false,
    rawText: value === null ? '' : String(value),
  }
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

function snap(n: number, step: number, anchor = 0): number {
  if (step <= 0) return n
  const origin = isFinite(anchor) ? anchor : 0
  const decimals = decimalPlaces(step)
  const steps = Math.round((n - origin) / step)
  const snapped = origin + steps * step
  return Number(snapped.toFixed(decimals))
}

function decimalPlaces(n: number): number {
  if (Math.floor(n) === n) return 0
  const str = n.toString()
  const dot = str.indexOf('.')
  return dot === -1 ? 0 : str.length - dot - 1
}

export function update(state: NumberInputState, msg: NumberInputMsg): [NumberInputState, never[]] {
  if (msg.type !== 'setDisabled' && (state.disabled || state.readOnly)) {
    // Allow setRawText for controlled typing? No — disabled means no interaction.
    return [state, []]
  }
  switch (msg.type) {
    case 'setValue': {
      const v =
        msg.value === null
          ? null
          : clamp(snap(msg.value, state.step, state.min), state.min, state.max)
      return [{ ...state, value: v, rawText: v === null ? '' : String(v) }, []]
    }
    case 'setRawText':
      return [{ ...state, rawText: msg.text }, []]
    case 'commit': {
      const parsed = parseFloat(state.rawText)
      if (isNaN(parsed))
        return [{ ...state, rawText: state.value === null ? '' : String(state.value) }, []]
      const v = clamp(snap(parsed, state.step, state.min), state.min, state.max)
      return [{ ...state, value: v, rawText: String(v) }, []]
    }
    case 'increment': {
      const base = state.value ?? 0
      const raw = base + state.step * (msg.multiplier ?? 1)
      const decimals = decimalPlaces(state.step)
      const v = clamp(Number(raw.toFixed(decimals)), state.min, state.max)
      return [{ ...state, value: v, rawText: String(v) }, []]
    }
    case 'decrement': {
      const base = state.value ?? 0
      const raw = base - state.step * (msg.multiplier ?? 1)
      const decimals = decimalPlaces(state.step)
      const v = clamp(Number(raw.toFixed(decimals)), state.min, state.max)
      return [{ ...state, value: v, rawText: String(v) }, []]
    }
    case 'toMin':
      return [{ ...state, value: state.min, rawText: String(state.min) }, []]
    case 'toMax':
      return [{ ...state, value: state.max, rawText: String(state.max) }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

export interface NumberInputParts {
  root: {
    'data-scope': 'number-input'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  input: {
    type: 'text'
    role: 'spinbutton'
    inputMode: 'decimal'
    'aria-valuemin': Signal<number | undefined>
    'aria-valuemax': Signal<number | undefined>
    'aria-valuenow': Signal<number | undefined>
    'aria-disabled': Signal<'true' | undefined>
    'aria-readonly': Signal<'true' | undefined>
    disabled: Signal<boolean>
    readOnly: Signal<boolean>
    value: Signal<string>
    'data-scope': 'number-input'
    'data-part': 'input'
    onInput: (e: Event) => void
    onBlur: (e: FocusEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  increment: {
    type: 'button'
    'aria-label': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'number-input'
    'data-part': 'increment'
    tabIndex: -1
    onClick: (e: MouseEvent) => void
  }
  decrement: {
    type: 'button'
    'aria-label': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'number-input'
    'data-part': 'decrement'
    tabIndex: -1
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  incrementLabel?: string
  decrementLabel?: string
  /** Validate the numeric value before committing. Non-empty array blocks setValue. */
  validate?: (value: number) => string[] | null
}

export function connect(
  state: Signal<NumberInputState>,
  send: Send<NumberInputMsg>,
  opts: ConnectOptions = {},
): NumberInputParts {
  const locale = useContext(LocaleContext)
  const incrementLabel = opts.incrementLabel ?? locale.numberInput.increment
  const decrementLabel = opts.decrementLabel ?? locale.numberInput.decrement
  const validate = opts.validate

  const trySetValue = (value: number) => {
    if (validate) {
      const errors = validate(value)
      if (errors && errors.length > 0) return
    }
    send({ type: 'setValue', value })
  }

  return {
    root: {
      'data-scope': 'number-input',
      'data-part': 'root',
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
    },
    input: {
      type: 'text',
      role: 'spinbutton',
      inputMode: 'decimal',
      'aria-valuemin': state.map((st) => (isFinite(st.min) ? st.min : undefined)),
      'aria-valuemax': state.map((st) => (isFinite(st.max) ? st.max : undefined)),
      'aria-valuenow': state.map((st) => st.value ?? undefined),
      'aria-disabled': state.map((st) => (st.disabled ? 'true' : undefined)),
      'aria-readonly': state.map((st) => (st.readOnly ? 'true' : undefined)),
      disabled: state.map((st) => st.disabled),
      readOnly: state.map((st) => st.readOnly),
      value: state.map((st) => st.rawText),
      'data-scope': 'number-input',
      'data-part': 'input',
      onInput: tagSend(send, ['setRawText'], (e) => {
        const text = (e.target as HTMLInputElement).value
        send({ type: 'setRawText', text })
        const parsed = parseFloat(text)
        if (!isNaN(parsed)) trySetValue(parsed)
      }),
      onBlur: tagSend(send, ['commit'], () => send({ type: 'commit' })),
      onKeyDown: tagSend(send, ['increment', 'decrement', 'toMin', 'toMax', 'commit'], (e) => {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'increment' })
            return
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'decrement' })
            return
          case 'PageUp':
            e.preventDefault()
            send({ type: 'increment', multiplier: 10 })
            return
          case 'PageDown':
            e.preventDefault()
            send({ type: 'decrement', multiplier: 10 })
            return
          case 'Home':
            e.preventDefault()
            send({ type: 'toMin' })
            return
          case 'End':
            e.preventDefault()
            send({ type: 'toMax' })
            return
          case 'Enter':
            e.preventDefault()
            send({ type: 'commit' })
            return
        }
      }),
    },
    increment: {
      type: 'button',
      'aria-label': incrementLabel,
      'aria-disabled': state.map((st) =>
        st.disabled || st.readOnly || (st.value ?? 0) >= st.max ? 'true' : undefined,
      ),
      disabled: state.map((st) => st.disabled || st.readOnly || (st.value ?? 0) >= st.max),
      'data-scope': 'number-input',
      'data-part': 'increment',
      tabIndex: -1,
      onClick: tagSend(send, ['increment'], () => send({ type: 'increment' })),
    },
    decrement: {
      type: 'button',
      'aria-label': decrementLabel,
      'aria-disabled': state.map((st) =>
        st.disabled || st.readOnly || (st.value ?? 0) <= st.min ? 'true' : undefined,
      ),
      disabled: state.map((st) => st.disabled || st.readOnly || (st.value ?? 0) <= st.min),
      'data-scope': 'number-input',
      'data-part': 'decrement',
      tabIndex: -1,
      onClick: tagSend(send, ['decrement'], () => send({ type: 'decrement' })),
    },
  }
}

export const numberInput = { init, update, connect }
