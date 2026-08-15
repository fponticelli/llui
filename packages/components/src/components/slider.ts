import type { Send, Signal } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { clamp, clampToStep, finiteBound, stepBy } from '../utils/number.js'

/**
 * Slider — numeric input controlled by drag or keyboard. Supports multiple
 * thumbs (range slider) and horizontal/vertical orientations. The machine is
 * pure; pointer drag handling (pointermove listeners during a drag) is done
 * by the consumer via `startThumbDrag()` helper which returns a cleanup.
 */

export type Orientation = 'horizontal' | 'vertical'

export interface SliderState {
  /** One value per thumb. For a single-value slider, a one-element array. */
  value: number[]
  min: number
  max: number
  step: number
  disabled: boolean
  orientation: Orientation
  /** Minimum gap enforced between adjacent thumbs (range slider). */
  minStepsBetweenThumbs: number
  /** Reading direction. Under 'rtl' horizontal arrow keys are flipped. */
  dir: 'ltr' | 'rtl'
}

export type SliderMsg =
  /** @intent("Replace all thumb values at once") */
  | { type: 'setValue'; value: number[] }
  /** @intent("Set the value of the thumb at the given index. Ignored while disabled") */
  | { type: 'setThumb'; index: number; value: number }
  /** @intent("Move the thumb at the given index up by one step (or step × multiplier). Ignored while disabled") */
  | { type: 'increment'; index: number; multiplier?: number }
  /** @intent("Move the thumb at the given index down by one step (or step × multiplier). Ignored while disabled") */
  | { type: 'decrement'; index: number; multiplier?: number }
  /** @intent("Snap the thumb at the given index to the slider's minimum. Ignored while disabled") */
  | { type: 'toMin'; index: number }
  /** @intent("Snap the thumb at the given index to the slider's maximum. Ignored while disabled") */
  | { type: 'toMax'; index: number }
  /** @intent("Enable or disable the slider — a host/agent write, never gated") */
  | { type: 'setDisabled'; disabled: boolean }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }

export interface SliderInit {
  value?: number[]
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  orientation?: Orientation
  minStepsBetweenThumbs?: number
  dir?: 'ltr' | 'rtl'
}

export function init(opts: SliderInit = {}): SliderState {
  // init IS a mutation path. It used to store `opts.value` verbatim, which made
  // it the one remaining way to seed thumbs no drag could produce — off-grid,
  // outside [min,max], or closer together than the gap allows (#125). The seed
  // goes through the SAME normalisation `setValue` uses.
  //
  // The bounds go through `finiteBound` for the same reason (#177): they are
  // the grid, so nothing clamps them, and a non-finite one is both
  // unserializable and a way to switch that side of the clamp off entirely.
  // A slider's range is intrinsically bounded, so an unusable option takes the
  // default rather than an infinity.
  const state: SliderState = {
    value: opts.value ?? [0],
    min: finiteBound(opts.min) ?? 0,
    max: finiteBound(opts.max) ?? 100,
    step: finiteBound(opts.step) ?? 1,
    disabled: opts.disabled ?? false,
    orientation: opts.orientation ?? 'horizontal',
    minStepsBetweenThumbs: finiteBound(opts.minStepsBetweenThumbs) ?? 0,
    dir: opts.dir ?? 'ltr',
  }
  return { ...state, value: normalizeValues(state, state.value) }
}

/**
 * Place one thumb: clamp+snap through the shared grid, then bound it by its
 * neighbours. `values` is the array being built (not necessarily `state.value`)
 * so `setValue` can fold this over every index.
 *
 * The neighbour bounds go through `clampToStep` too. Two reasons, both of them
 * defects that shipped (#125): a bound derived from a raw or out-of-range
 * neighbour dragged the thumb outside `[min,max]`, and `clamp(n, lower, upper)`
 * with `upper < lower` returns `upper` — so a crowded thumb took whatever the
 * unnormalised neighbour happened to be, off grid and out of range. Bounds are
 * normalised into the range and onto the grid, then ORDERED, so the final
 * clamp can only ever return a legal value. Folding is still order-dependent —
 * it is NOT identical to a sequence of `setThumb`s: from `[10,20,30]`,
 * `setValue([90,10,50])` gives `[10,10,50]` where the setThumb sequence gives
 * `[20,20,50]` — but every value either can produce is one a drag could
 * produce, which is the property that matters.
 *
 * That claim needs no finiteness caveat: `NaN` used to survive every comparison
 * in `clamp` and land in state — a value no drag can produce and one
 * `JSON.stringify` turns into `null` — and the shared grid now rejects it at
 * the boundary (#152), so `rawValue` is normalised whatever the caller passes.
 */
function withThumb(
  state: SliderState,
  values: readonly number[],
  index: number,
  rawValue: number,
): number[] {
  const { min, max, step, minStepsBetweenThumbs } = state
  const next = [...values]
  const snapped = clampToStep(rawValue, state)
  // Enforce gap with neighbors
  const gap = minStepsBetweenThumbs * step
  const lowerBound = index > 0 ? clampToStep((next[index - 1] ?? min) + gap, state) : min
  const upperBound =
    index < next.length - 1 ? clampToStep((next[index + 1] ?? max) - gap, state) : max
  next[index] = clamp(snapped, Math.min(lowerBound, upperBound), Math.max(lowerBound, upperBound))
  return next
}

function setThumbValue(state: SliderState, index: number, rawValue: number): number[] {
  return withThumb(state, state.value, index, rawValue)
}

/**
 * Normalise a whole thumb array — the path `init` and `setValue` share.
 *
 * NORMALISE FIRST, bound second: folding `withThumb` over the raw array bounds
 * each thumb by its still-unnormalised neighbour, which is how a raw value
 * leaked back into state through the gap clamp (#125).
 */
function normalizeValues(state: SliderState, values: readonly number[]): number[] {
  let next = values.map((v) => clampToStep(v, state))
  for (let i = 0; i < next.length; i++) next = withThumb(state, next, i, next[i]!)
  return next
}

/**
 * Messages a disabled slider still accepts. `disabled` gates HUMAN interaction
 * — dragging a thumb, arrow keys — not the host's or an agent's programmatic
 * writes, which used to be dropped too (#120). *
 * This allow-list and the `@intent`/`@humanOnly` JSDoc on the Msg union answer
 * DIFFERENT questions — "does this survive the gate" versus "may an agent
 * dispatch it at all" — and they must not contradict each other: every message
 * named here is agent-dispatchable, and every gated variant an agent may still
 * send says so in its `@intent` text instead of promising a write the gate
 * swallows. `test/disabled-gate-annotations.test.ts` fails the build if the two
 * drift apart (#138 review).
 */
const PROGRAMMATIC: ReadonlySet<SliderMsg['type']> = new Set(['setValue', 'setDisabled', 'setDir'])

export function update(state: SliderState, msg: SliderMsg): [SliderState, never[]] {
  if (state.disabled && !PROGRAMMATIC.has(msg.type)) return [state, []]
  switch (msg.type) {
    case 'setValue': {
      // Every thumb goes through the SAME clamp+snap+gap path `setThumb` uses.
      // It used to store the array raw, so a programmatic set could hold values
      // no drag could ever produce — off-grid, or outside [min,max] (#125).
      return [{ ...state, value: normalizeValues(state, msg.value) }, []]
    }
    case 'setThumb':
      return [{ ...state, value: setThumbValue(state, msg.index, msg.value) }, []]
    case 'increment': {
      const m = msg.multiplier ?? 1
      const current = state.value[msg.index] ?? state.min
      return [{ ...state, value: setThumbValue(state, msg.index, stepBy(current, m, state)) }, []]
    }
    case 'decrement': {
      const m = msg.multiplier ?? 1
      const current = state.value[msg.index] ?? state.min
      return [{ ...state, value: setThumbValue(state, msg.index, stepBy(current, -m, state)) }, []]
    }
    case 'toMin':
      return [{ ...state, value: setThumbValue(state, msg.index, state.min) }, []]
    case 'toMax':
      return [{ ...state, value: setThumbValue(state, msg.index, state.max) }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
    case 'setDir':
      return [{ ...state, dir: msg.dir }, []]
  }
}

function thumbPercent(state: SliderState, index: number): number {
  const v = state.value[index] ?? state.min
  const range = state.max - state.min
  if (range === 0) return 0
  return ((v - state.min) / range) * 100
}

export interface SliderThumbParts {
  thumb: {
    role: 'slider'
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number>
    'aria-orientation': Signal<Orientation>
    'aria-disabled': Signal<'true' | undefined>
    'data-orientation': Signal<Orientation>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'slider'
    'data-part': 'thumb'
    'data-index': string
    tabindex: Signal<number>
    onKeyDown: (e: KeyboardEvent) => void
    style: Signal<string>
  }
}

export interface SliderParts {
  root: {
    'data-scope': 'slider'
    'data-part': 'root'
    'data-orientation': Signal<Orientation>
    'data-disabled': Signal<'' | undefined>
  }
  control: {
    'data-scope': 'slider'
    'data-part': 'control'
    'data-orientation': Signal<Orientation>
    onPointerDown: (e: PointerEvent) => void
  }
  track: {
    'data-scope': 'slider'
    'data-part': 'track'
    'data-orientation': Signal<Orientation>
  }
  range: {
    'data-scope': 'slider'
    'data-part': 'range'
    'data-orientation': Signal<Orientation>
    style: Signal<string>
  }
  thumb: (index: number) => SliderThumbParts
  /** Current raw values — reactive convenience. */
  value: Signal<number[]>
}

export function connect(state: Signal<SliderState>, send: Send<SliderMsg>): SliderParts {
  return {
    root: {
      'data-scope': 'slider',
      'data-part': 'root',
      'data-orientation': state.map((s) => s.orientation),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    control: {
      'data-scope': 'slider',
      'data-part': 'control',
      'data-orientation': state.map((s) => s.orientation),
      // Consumers attach their own pointer drag logic via onMount, using
      // `valueFromPoint` + `closestThumbIndex` helpers. The connect layer
      // preventDefault's to suppress text selection while dragging.
      onPointerDown: (e: PointerEvent) => e.preventDefault(),
    },
    track: {
      'data-scope': 'slider',
      'data-part': 'track',
      'data-orientation': state.map((s) => s.orientation),
    },
    range: {
      'data-scope': 'slider',
      'data-part': 'range',
      'data-orientation': state.map((s) => s.orientation),
      style: state.map((s) => rangeStyle(s)),
    },
    thumb: (index: number): SliderThumbParts => ({
      thumb: {
        role: 'slider',
        'aria-valuemin': state.map((s) => s.min),
        'aria-valuemax': state.map((s) => s.max),
        'aria-valuenow': state.map((s) => s.value[index] ?? s.min),
        'aria-orientation': state.map((s) => s.orientation),
        'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
        'data-orientation': state.map((s) => s.orientation),
        'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
        'data-scope': 'slider',
        'data-part': 'thumb',
        'data-index': String(index),
        tabindex: state.map((s) => (s.disabled ? -1 : 0)),
        style: state.map((s) => thumbStyle(s, index)),
        onKeyDown: (e: KeyboardEvent) => handleThumbKey(e, index, send, state.peek()?.dir ?? 'ltr'),
      },
    }),
    value: state.map((s) => s.value),
  }
}

function handleThumbKey(
  e: KeyboardEvent,
  index: number,
  send: Send<SliderMsg>,
  dir: 'ltr' | 'rtl',
): void {
  const key = flipArrow(e.key, dir)
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      e.preventDefault()
      send({ type: 'increment', index })
      return
    case 'ArrowLeft':
    case 'ArrowDown':
      e.preventDefault()
      send({ type: 'decrement', index })
      return
    case 'PageUp':
      e.preventDefault()
      send({ type: 'increment', index, multiplier: 10 })
      return
    case 'PageDown':
      e.preventDefault()
      send({ type: 'decrement', index, multiplier: 10 })
      return
    case 'Home':
      e.preventDefault()
      send({ type: 'toMin', index })
      return
    case 'End':
      e.preventDefault()
      send({ type: 'toMax', index })
      return
  }
}

function thumbStyle(state: SliderState, index: number): string {
  const pct = thumbPercent(state, index)
  if (state.orientation === 'horizontal') {
    return `position:absolute;left:${pct}%;transform:translateX(-50%);`
  }
  return `position:absolute;bottom:${pct}%;transform:translateY(50%);`
}

function rangeStyle(state: SliderState): string {
  if (state.value.length === 0) return ''
  const sorted = [...state.value].sort((a, b) => a - b)
  const low = sorted[0]!
  const high = sorted[sorted.length - 1]!
  const range = state.max - state.min
  if (range === 0) return ''
  const startPct = ((low - state.min) / range) * 100
  const endPct = ((high - state.min) / range) * 100
  if (state.orientation === 'horizontal') {
    return `position:absolute;left:${startPct}%;right:${100 - endPct}%;`
  }
  return `position:absolute;bottom:${startPct}%;top:${100 - endPct}%;`
}

/**
 * Compute the slider value at a given pointer position within the control's
 * bounding rect. Returns null if the pointer is outside the track.
 */
export function valueFromPoint(
  state: SliderState,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): number {
  const { min, max, orientation } = state
  let pct: number
  if (orientation === 'horizontal') {
    pct = (clientX - rect.left) / rect.width
  } else {
    pct = 1 - (clientY - rect.top) / rect.height
  }
  return clampToStep(min + pct * (max - min), state)
}

/** Determine which thumb index is closest to a given raw value. */
export function closestThumbIndex(state: SliderState, raw: number): number {
  if (state.value.length === 0) return 0
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < state.value.length; i++) {
    const d = Math.abs((state.value[i] ?? 0) - raw)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

export const slider = { init, update, connect, valueFromPoint, closestThumbIndex }
