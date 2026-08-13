import type { Send, Signal } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { clamp, clampToStep, stepBy } from '../utils/number.js'

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
  /** @intent("Set the value of the thumb at the given index") */
  | { type: 'setThumb'; index: number; value: number }
  /** @intent("Move the thumb at the given index up by one step (or step × multiplier)") */
  | { type: 'increment'; index: number; multiplier?: number }
  /** @intent("Move the thumb at the given index down by one step (or step × multiplier)") */
  | { type: 'decrement'; index: number; multiplier?: number }
  /** @intent("Snap the thumb at the given index to the slider's minimum") */
  | { type: 'toMin'; index: number }
  /** @intent("Snap the thumb at the given index to the slider's maximum") */
  | { type: 'toMax'; index: number }
  /** @humanOnly */
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
  return {
    value: opts.value ?? [0],
    min: opts.min ?? 0,
    max: opts.max ?? 100,
    step: opts.step ?? 1,
    disabled: opts.disabled ?? false,
    orientation: opts.orientation ?? 'horizontal',
    minStepsBetweenThumbs: opts.minStepsBetweenThumbs ?? 0,
    dir: opts.dir ?? 'ltr',
  }
}

/**
 * Place one thumb: clamp+snap through the shared grid, then bound it by its
 * neighbours. `values` is the array being built (not necessarily `state.value`)
 * so `setValue` can fold this over every index and get exactly what a sequence
 * of `setThumb`s would produce.
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
  const lowerBound = index > 0 ? (next[index - 1] ?? min) + gap : min
  const upperBound = index < next.length - 1 ? (next[index + 1] ?? max) - gap : max
  next[index] = clamp(snapped, lowerBound, upperBound)
  return next
}

function setThumbValue(state: SliderState, index: number, rawValue: number): number[] {
  return withThumb(state, state.value, index, rawValue)
}

export function update(state: SliderState, msg: SliderMsg): [SliderState, never[]] {
  if (state.disabled && msg.type !== 'setDisabled' && msg.type !== 'setDir') return [state, []]
  switch (msg.type) {
    case 'setValue': {
      // Every thumb goes through the SAME clamp+snap+gap path `setThumb` uses.
      // It used to store the array raw, so a programmatic set could hold values
      // no drag could ever produce — off-grid, or outside [min,max] (#125).
      let value: number[] = [...msg.value]
      for (let i = 0; i < value.length; i++) value = withThumb(state, value, i, value[i]!)
      return [{ ...state, value }, []]
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
