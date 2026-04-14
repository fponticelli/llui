import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'

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
}

export type SliderMsg =
  | { type: 'setValue'; value: number[] }
  | { type: 'setThumb'; index: number; value: number }
  | { type: 'increment'; index: number; multiplier?: number }
  | { type: 'decrement'; index: number; multiplier?: number }
  | { type: 'toMin'; index: number }
  | { type: 'toMax'; index: number }
  | { type: 'setDisabled'; disabled: boolean }

export interface SliderInit {
  value?: number[]
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  orientation?: Orientation
  minStepsBetweenThumbs?: number
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
  }
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

function snapToStep(n: number, min: number, step: number): number {
  const steps = Math.round((n - min) / step)
  const snapped = min + steps * step
  // Avoid floating-point drift — round to precision of step
  const decimals = decimalPlaces(step)
  return Number(snapped.toFixed(decimals))
}

function decimalPlaces(n: number): number {
  if (Math.floor(n) === n) return 0
  const str = n.toString()
  const dot = str.indexOf('.')
  return dot === -1 ? 0 : str.length - dot - 1
}

function setThumbValue(state: SliderState, index: number, rawValue: number): number[] {
  const { min, max, step, minStepsBetweenThumbs } = state
  const snapped = snapToStep(clamp(rawValue, min, max), min, step)
  const value = [...state.value]
  // Enforce gap with neighbors
  const gap = minStepsBetweenThumbs * step
  const lowerBound = index > 0 ? (value[index - 1] ?? min) + gap : min
  const upperBound = index < value.length - 1 ? (value[index + 1] ?? max) - gap : max
  value[index] = clamp(snapped, lowerBound, upperBound)
  return value
}

export function update(state: SliderState, msg: SliderMsg): [SliderState, never[]] {
  if (state.disabled && msg.type !== 'setDisabled') return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setThumb':
      return [{ ...state, value: setThumbValue(state, msg.index, msg.value) }, []]
    case 'increment': {
      const m = msg.multiplier ?? 1
      const current = state.value[msg.index] ?? state.min
      return [{ ...state, value: setThumbValue(state, msg.index, current + state.step * m) }, []]
    }
    case 'decrement': {
      const m = msg.multiplier ?? 1
      const current = state.value[msg.index] ?? state.min
      return [{ ...state, value: setThumbValue(state, msg.index, current - state.step * m) }, []]
    }
    case 'toMin':
      return [{ ...state, value: setThumbValue(state, msg.index, state.min) }, []]
    case 'toMax':
      return [{ ...state, value: setThumbValue(state, msg.index, state.max) }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

function thumbPercent(state: SliderState, index: number): number {
  const v = state.value[index] ?? state.min
  const range = state.max - state.min
  if (range === 0) return 0
  return ((v - state.min) / range) * 100
}

export interface SliderThumbParts<S> {
  thumb: {
    role: 'slider'
    'aria-valuemin': (s: S) => number
    'aria-valuemax': (s: S) => number
    'aria-valuenow': (s: S) => number
    'aria-orientation': (s: S) => Orientation
    'aria-disabled': (s: S) => 'true' | undefined
    'data-orientation': (s: S) => Orientation
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'slider'
    'data-part': 'thumb'
    'data-index': string
    tabIndex: (s: S) => number
    onKeyDown: (e: KeyboardEvent) => void
    style: (s: S) => string
  }
}

export interface SliderParts<S> {
  root: {
    'data-scope': 'slider'
    'data-part': 'root'
    'data-orientation': (s: S) => Orientation
    'data-disabled': (s: S) => '' | undefined
  }
  control: {
    'data-scope': 'slider'
    'data-part': 'control'
    'data-orientation': (s: S) => Orientation
    onPointerDown: (e: PointerEvent) => void
  }
  track: {
    'data-scope': 'slider'
    'data-part': 'track'
    'data-orientation': (s: S) => Orientation
  }
  range: {
    'data-scope': 'slider'
    'data-part': 'range'
    'data-orientation': (s: S) => Orientation
    style: (s: S) => string
  }
  thumb: (index: number) => SliderThumbParts<S>
  /** Current raw values — accessor convenience. */
  value: (s: S) => number[]
}

export function connect<S>(get: (s: S) => SliderState, send: Send<SliderMsg>): SliderParts<S> {
  return {
    root: {
      'data-scope': 'slider',
      'data-part': 'root',
      'data-orientation': (s) => get(s).orientation,
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    control: {
      'data-scope': 'slider',
      'data-part': 'control',
      'data-orientation': (s) => get(s).orientation,
      // Consumers attach their own pointer drag logic via onMount, using
      // `valueFromPoint` + `closestThumbIndex` helpers. The connect layer
      // preventDefault's to suppress text selection while dragging.
      onPointerDown: (e: PointerEvent) => e.preventDefault(),
    },
    track: {
      'data-scope': 'slider',
      'data-part': 'track',
      'data-orientation': (s) => get(s).orientation,
    },
    range: {
      'data-scope': 'slider',
      'data-part': 'range',
      'data-orientation': (s) => get(s).orientation,
      style: (s) => rangeStyle(get(s)),
    },
    thumb: (index: number): SliderThumbParts<S> => ({
      thumb: {
        role: 'slider',
        'aria-valuemin': (s) => get(s).min,
        'aria-valuemax': (s) => get(s).max,
        'aria-valuenow': (s) => get(s).value[index] ?? get(s).min,
        'aria-orientation': (s) => get(s).orientation,
        'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
        'data-orientation': (s) => get(s).orientation,
        'data-disabled': (s) => (get(s).disabled ? '' : undefined),
        'data-scope': 'slider',
        'data-part': 'thumb',
        'data-index': String(index),
        tabIndex: (s) => (get(s).disabled ? -1 : 0),
        style: (s) => thumbStyle(get(s), index),
        onKeyDown: (e: KeyboardEvent) => handleThumbKey(e, index, send),
      },
    }),
    value: (s) => get(s).value,
  }
}

function handleThumbKey(e: KeyboardEvent, index: number, send: Send<SliderMsg>): void {
  const key = flipArrow(e.key, e.currentTarget as Element)
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
  const { min, max, step, orientation } = state
  let pct: number
  if (orientation === 'horizontal') {
    pct = (clientX - rect.left) / rect.width
  } else {
    pct = 1 - (clientY - rect.top) / rect.height
  }
  const raw = min + pct * (max - min)
  return snapToStep(clamp(raw, min, max), min, step)
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
