import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { numberInputLocale } from '../locale/number-input.js'
import { allFiniteNumbers, clampToStep, finiteBound, stepBy } from '../utils/number.js'

/**
 * Number input — numeric field with increment/decrement buttons. Clamps
 * to min/max and snaps to step. Keyboard: Arrow Up/Down, PageUp/PageDown,
 * Home/End.
 */

export interface NumberInputState {
  value: number | null
  /**
   * The bounds, ABSENT when that side is unbounded — the state's `min`/`max`/
   * `step` ARE a `NumericGrid`, which is what lets `clampToStep(value, state)`
   * take the state object straight in.
   *
   * A bound is never `±Infinity` and never `NaN`: this is the ONE component in
   * the package whose DEFAULT range is unbounded, and it used to spell that
   * `min: -Infinity` / `max: Infinity` in state, which `JSON.stringify` writes
   * as `null` — so its default state did not survive a round trip and the
   * rehydrated object held `null` in a `number` field (#177). Absence is the
   * serializable spelling of the same fact; `finiteBound` is the one place it
   * is decided.
   */
  min?: number
  max?: number
  step: number
  disabled: boolean
  readonly: boolean
  /** Allow a free-text input value while the user is typing. */
  rawText: string
}

export type NumberInputMsg =
  /** @intent("Set the numeric value (clamped to min/max, snapped to step)") */
  | { type: 'setValue'; value: number | null }
  /** @humanOnly */
  | { type: 'setRawText'; text: string }
  /** @intent("Commit the in-progress text input — parse, clamp, snap, and update value. Ignored while disabled or readonly") */
  | { type: 'commit' }
  /** @intent("Increase value by step (or step × multiplier). Ignored while disabled or readonly") */
  | { type: 'increment'; multiplier?: number }
  /** @intent("Decrease value by step (or step × multiplier). Ignored while disabled or readonly") */
  | { type: 'decrement'; multiplier?: number }
  /** @intent("Snap value to the configured minimum. Ignored while disabled or readonly") */
  | { type: 'toMin' }
  /** @intent("Snap value to the configured maximum. Ignored while disabled or readonly") */
  | { type: 'toMax' }
  /** @intent("Enable or disable the input — a host/agent write, never gated") */
  | { type: 'setDisabled'; disabled: boolean }

export interface NumberInputInit {
  value?: number | null
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  readonly?: boolean
}

export function init(opts: NumberInputInit = {}): NumberInputState {
  // init IS a mutation path. It used to store `opts.value` verbatim, which made
  // it the one remaining way to seed a value no other path could produce —
  // off-grid or outside [min,max] (#125).
  //
  // It is the only write path for the BOUNDS too (no message sets one), and the
  // keys are OMITTED rather than set to `undefined` when a side is unbounded:
  // `JSON.stringify` drops an `undefined` property, so a state carrying
  // `min: undefined` would rehydrate WITHOUT the key and the live and
  // rehydrated objects would differ by a key — which is exactly the comparison
  // devtools time-travel and `@llui/test` replay make (#177).
  const min = finiteBound(opts.min)
  const max = finiteBound(opts.max)
  const grid: Pick<NumberInputState, 'min' | 'max' | 'step'> = {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    step: finiteBound(opts.step) ?? 1,
  }
  const seed = opts.value ?? null
  const value = seed === null ? null : clampToStep(seed, grid)
  return {
    value,
    ...grid,
    disabled: opts.disabled ?? false,
    readonly: opts.readonly ?? false,
    rawText: value === null ? '' : String(value),
  }
}

/**
 * Store a value the grid already validated, keeping `rawText` in step. Every
 * mutation lands here so the displayed text can never disagree with `value`.
 * `NumberInputState` names its bounds `min`/`max`/`step`, so it IS a
 * `NumericGrid` — the clamp/snap rules take the state itself.
 */
function commit(state: NumberInputState, value: number): NumberInputState {
  return { ...state, value, rawText: String(value) }
}

/**
 * Is the value sitting on a bound — i.e. is that stepper button spent? An
 * ABSENT bound is unbounded, so the answer is no: the old `>= Infinity` said
 * the same thing, and the explicit test says it without a sentinel (#177).
 */
function atMax(state: NumberInputState): boolean {
  return state.max !== undefined && (state.value ?? 0) >= state.max
}

function atMin(state: NumberInputState): boolean {
  return state.min !== undefined && (state.value ?? 0) <= state.min
}

/**
 * Messages a disabled/readonly instance still accepts. `disabled` gates HUMAN
 * interaction — typing, stepping, committing text — not the host's or an
 * agent's programmatic writes, which used to be dropped too (#120). *
 * This allow-list and the `@intent`/`@humanOnly` JSDoc on the Msg union answer
 * DIFFERENT questions — "does this survive the gate" versus "may an agent
 * dispatch it at all" — and they must not contradict each other: every message
 * named here is agent-dispatchable, and every gated variant an agent may still
 * send says so in its `@intent` text instead of promising a write the gate
 * swallows. `test/disabled-gate-annotations.test.ts` fails the build if the two
 * drift apart (#138 review).
 */
const PROGRAMMATIC: ReadonlySet<NumberInputMsg['type']> = new Set(['setValue', 'setDisabled'])

export function update(state: NumberInputState, msg: NumberInputMsg): [NumberInputState, never[]] {
  if (
    (msg.type === 'increment' || msg.type === 'decrement') &&
    msg.multiplier !== undefined &&
    !allFiniteNumbers(msg.multiplier)
  ) {
    return [state, []]
  }
  if ((state.disabled || state.readonly) && !PROGRAMMATIC.has(msg.type)) {
    return [state, []]
  }
  switch (msg.type) {
    case 'setValue': {
      const v = msg.value === null ? null : clampToStep(msg.value, state)
      return [{ ...state, value: v, rawText: v === null ? '' : String(v) }, []]
    }
    case 'setRawText':
      return [{ ...state, rawText: msg.text }, []]
    case 'commit': {
      const parsed = parseFloat(state.rawText)
      if (isNaN(parsed))
        return [{ ...state, rawText: state.value === null ? '' : String(state.value) }, []]
      return [commit(state, clampToStep(parsed, state)), []]
    }
    case 'increment':
      return [commit(state, stepBy(state.value ?? 0, msg.multiplier ?? 1, state)), []]
    case 'decrement':
      return [commit(state, stepBy(state.value ?? 0, -(msg.multiplier ?? 1), state)), []]
    // An ABSENT bound is unbounded, so it expands to the infinity the grid
    // would have expanded it to anyway — and `clamp` maps that to a finite
    // legal value when the bound it points at is itself infinite (#152), which
    // is what keeps Home/End on an unbounded input storing a real number.
    case 'toMin':
      return [commit(state, clampToStep(state.min ?? -Infinity, state)), []]
    case 'toMax':
      return [commit(state, clampToStep(state.max ?? Infinity, state)), []]
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
    inputmode: 'decimal'
    'aria-valuemin': Signal<number | undefined>
    'aria-valuemax': Signal<number | undefined>
    'aria-valuenow': Signal<number | undefined>
    'aria-disabled': Signal<'true' | undefined>
    'aria-readonly': Signal<'true' | undefined>
    disabled: Signal<boolean>
    readonly: Signal<boolean>
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
    tabindex: -1
    onClick: (e: MouseEvent) => void
  }
  decrement: {
    type: 'button'
    'aria-label': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'number-input'
    'data-part': 'decrement'
    tabindex: -1
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
  const locale = numberInputLocale()
  const incrementLabel = opts.incrementLabel ?? locale.increment
  const decrementLabel = opts.decrementLabel ?? locale.decrement
  const validate = opts.validate

  // Commit the in-progress text (blur / Enter). We never commit live from
  // `onInput` — clamping/snapping mid-keystroke destroys in-progress typing
  // (e.g. "1." → "1", or step:5 "12" → "10"). `validate` gates the commit:
  // when it reports errors we leave the raw text untouched and skip the commit.
  const commitFromEvent = (target: HTMLInputElement) => {
    if (validate) {
      const parsed = parseFloat(target.value)
      if (!isNaN(parsed)) {
        const errors = validate(parsed)
        if (errors && errors.length > 0) return
      }
    }
    send({ type: 'commit' })
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
      inputmode: 'decimal',
      // No `isFinite` filter needed any more: a bound in state is finite or
      // absent, and an absent one must not be announced (#177).
      'aria-valuemin': state.map((st) => st.min),
      'aria-valuemax': state.map((st) => st.max),
      'aria-valuenow': state.map((st) => st.value ?? undefined),
      'aria-disabled': state.map((st) => (st.disabled ? 'true' : undefined)),
      'aria-readonly': state.map((st) => (st.readonly ? 'true' : undefined)),
      disabled: state.map((st) => st.disabled),
      readonly: state.map((st) => st.readonly),
      value: state.map((st) => st.rawText),
      'data-scope': 'number-input',
      'data-part': 'input',
      onInput: tagSend(send, ['setRawText'], (e) => {
        const text = (e.target as HTMLInputElement).value
        send({ type: 'setRawText', text })
      }),
      onBlur: tagSend(send, ['commit'], (e) => commitFromEvent(e.target as HTMLInputElement)),
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
            commitFromEvent(e.target as HTMLInputElement)
            return
        }
      }),
    },
    increment: {
      type: 'button',
      'aria-label': incrementLabel,
      'aria-disabled': state.map((st) =>
        st.disabled || st.readonly || atMax(st) ? 'true' : undefined,
      ),
      disabled: state.map((st) => st.disabled || st.readonly || atMax(st)),
      'data-scope': 'number-input',
      'data-part': 'increment',
      tabindex: -1,
      onClick: tagSend(send, ['increment'], () => send({ type: 'increment' })),
    },
    decrement: {
      type: 'button',
      'aria-label': decrementLabel,
      'aria-disabled': state.map((st) =>
        st.disabled || st.readonly || atMin(st) ? 'true' : undefined,
      ),
      disabled: state.map((st) => st.disabled || st.readonly || atMin(st)),
      'data-scope': 'number-input',
      'data-part': 'decrement',
      tabindex: -1,
      onClick: tagSend(send, ['decrement'], () => send({ type: 'decrement' })),
    },
  }
}

export const numberInput = { init, update, connect }
