import type { Send, Signal } from '@llui/dom'

/**
 * Meter — role="meter" gauge for a scalar measurement within a known range
 * (e.g. disk usage, battery level). Distinct from progressbar: a meter is never
 * indeterminate and represents a static measurement rather than task progress.
 * `low`/`high`/`optimum` mirror the native <meter> attributes and drive the
 * threshold styling exposed via `data-state`.
 */

export interface MeterState {
  value: number
  min: number
  max: number
  low?: number
  high?: number
  optimum?: number
}

export type MeterMsg =
  /** @humanOnly */
  | { type: 'setValue'; value: number }
  /** @humanOnly */
  | { type: 'setMax'; max: number }

export interface MeterInit {
  value?: number
  min?: number
  max?: number
  low?: number
  high?: number
  optimum?: number
}

export function init(opts: MeterInit = {}): MeterState {
  const state: MeterState = {
    value: opts.value ?? 0,
    min: opts.min ?? 0,
    max: opts.max ?? 100,
  }
  if (opts.low !== undefined) state.low = opts.low
  if (opts.high !== undefined) state.high = opts.high
  if (opts.optimum !== undefined) state.optimum = opts.optimum
  return state
}

export function update(state: MeterState, msg: MeterMsg): [MeterState, never[]] {
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setMax':
      return [{ ...state, max: msg.max }, []]
  }
}

export function percent(state: MeterState): number {
  const range = state.max - state.min
  if (range <= 0) return 0
  return ((state.value - state.min) / range) * 100
}

export type MeterThreshold = 'low' | 'optimal' | 'high'

/**
 * Derives the threshold band the current value falls into, following the
 * native <meter> semantics:
 * - below `low` → the value is in the lower segment;
 * - above `high` → the value is in the upper segment;
 * - otherwise → the value is in the middle segment.
 * Whether a segment is "good" depends on `optimum`: the segment containing
 * `optimum` is 'optimal'; the segment adjacent to it is the lesser-preferred
 * band; and the far segment is the worst. We map the worst → 'low', the
 * preferred → 'optimal', and the in-between → 'high'. When `low`/`high` are
 * missing the value is considered to be in the middle segment; when `optimum`
 * is missing every band reads as 'optimal'.
 */
export function thresholdState(state: MeterState): MeterThreshold {
  const { value, low, high, optimum } = state

  // Which segment is the value in? low/optimal/high by position.
  const segment: MeterThreshold =
    low !== undefined && value < low
      ? 'low'
      : high !== undefined && value > high
        ? 'high'
        : 'optimal'

  // Without an optimum point, position alone has no preference: all optimal.
  if (optimum === undefined) return 'optimal'

  // Which segment does optimum sit in?
  const optimumSegment: MeterThreshold =
    low !== undefined && optimum < low
      ? 'low'
      : high !== undefined && optimum > high
        ? 'high'
        : 'optimal'

  if (segment === optimumSegment) return 'optimal'

  // Distance (in segment index) from the optimum's segment determines quality.
  const index = (s: MeterThreshold): number => (s === 'low' ? 0 : s === 'optimal' ? 1 : 2)
  const distance = Math.abs(index(segment) - index(optimumSegment))

  // Adjacent segment → sub-optimal but acceptable ('high'); far segment → worst ('low').
  return distance >= 2 ? 'low' : 'high'
}

export interface MeterParts {
  root: {
    role: 'meter'
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number>
    'aria-valuetext': Signal<string>
    'aria-label': string | undefined
    'data-state': Signal<MeterThreshold>
    'data-scope': 'meter'
    'data-part': 'root'
  }
  track: {
    'data-state': Signal<MeterThreshold>
    'data-scope': 'meter'
    'data-part': 'track'
  }
  range: {
    'data-state': Signal<MeterThreshold>
    'data-scope': 'meter'
    'data-part': 'range'
    style: Signal<string>
  }
  label: {
    'data-scope': 'meter'
    'data-part': 'label'
  }
  valueText: Signal<string>
}

export interface ConnectOptions {
  label?: string
  /** Custom formatter for value text. */
  format?: (value: number, max: number) => string
}

export function connect(
  state: Signal<MeterState>,
  _send: Send<MeterMsg>,
  opts: ConnectOptions = {},
): MeterParts {
  const label = opts.label
  const format = opts.format
  const valueText = (s: MeterState): string => (format ? format(s.value, s.max) : defaultFormat(s))

  return {
    root: {
      role: 'meter',
      'aria-valuemin': state.map((s) => s.min),
      'aria-valuemax': state.map((s) => s.max),
      'aria-valuenow': state.map((s) => s.value),
      'aria-valuetext': state.map((s) => valueText(s)),
      'aria-label': label,
      'data-state': state.map((s) => thresholdState(s)),
      'data-scope': 'meter',
      'data-part': 'root',
    },
    track: {
      'data-state': state.map((s) => thresholdState(s)),
      'data-scope': 'meter',
      'data-part': 'track',
    },
    range: {
      'data-state': state.map((s) => thresholdState(s)),
      'data-scope': 'meter',
      'data-part': 'range',
      style: state.map((s) => rangeStyle(s)),
    },
    label: {
      'data-scope': 'meter',
      'data-part': 'label',
    },
    valueText: state.map((s) => valueText(s)),
  }
}

function defaultFormat(state: MeterState): string {
  return `${Math.round(percent(state))}%`
}

function rangeStyle(state: MeterState): string {
  const clamped = Math.max(0, Math.min(100, percent(state)))
  return `inline-size:${clamped}%;`
}

export const meter = { init, update, connect, percent, thresholdState }
