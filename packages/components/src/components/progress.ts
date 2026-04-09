import type { Send } from '@llui/dom'
import { en } from '../locale'

/**
 * Progress — linear or circular progress indicator. Determinate (0..max) or
 * indeterminate (`value: null`).
 */

export type ProgressOrientation = 'horizontal' | 'vertical'

export interface ProgressState {
  value: number | null
  min: number
  max: number
  orientation: ProgressOrientation
}

export type ProgressMsg =
  | { type: 'setValue'; value: number | null }
  | { type: 'setMax'; max: number }

export interface ProgressInit {
  value?: number | null
  min?: number
  max?: number
  orientation?: ProgressOrientation
}

export function init(opts: ProgressInit = {}): ProgressState {
  return {
    value: 'value' in opts ? (opts.value as number | null) : 0,
    min: opts.min ?? 0,
    max: opts.max ?? 100,
    orientation: opts.orientation ?? 'horizontal',
  }
}

export function update(state: ProgressState, msg: ProgressMsg): [ProgressState, never[]] {
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setMax':
      return [{ ...state, max: msg.max }, []]
  }
}

export function percent(state: ProgressState): number | null {
  if (state.value === null) return null
  const range = state.max - state.min
  if (range <= 0) return 0
  return ((state.value - state.min) / range) * 100
}

export function valueState(state: ProgressState): 'indeterminate' | 'complete' | 'loading' {
  if (state.value === null) return 'indeterminate'
  if (state.value >= state.max) return 'complete'
  return 'loading'
}

export interface ProgressParts<S> {
  root: {
    role: 'progressbar'
    'aria-valuemin': (s: S) => number
    'aria-valuemax': (s: S) => number
    'aria-valuenow': (s: S) => number | undefined
    'aria-label': string | undefined
    'data-state': (s: S) => 'indeterminate' | 'complete' | 'loading'
    'data-orientation': (s: S) => ProgressOrientation
    'data-scope': 'progress'
    'data-part': 'root'
  }
  track: {
    'data-state': (s: S) => 'indeterminate' | 'complete' | 'loading'
    'data-orientation': (s: S) => ProgressOrientation
    'data-scope': 'progress'
    'data-part': 'track'
  }
  range: {
    'data-state': (s: S) => 'indeterminate' | 'complete' | 'loading'
    'data-orientation': (s: S) => ProgressOrientation
    'data-scope': 'progress'
    'data-part': 'range'
    style: (s: S) => string
  }
  label: {
    'data-scope': 'progress'
    'data-part': 'label'
  }
  valueText: (s: S) => string
}

export interface ConnectOptions {
  label?: string
  /** Custom formatter for value text. */
  format?: (value: number | null, max: number) => string
}

export function connect<S>(
  get: (s: S) => ProgressState,
  _send: Send<ProgressMsg>,
  opts: ConnectOptions = {},
): ProgressParts<S> {
  const label = opts.label
  const format = opts.format ?? defaultFormat

  return {
    root: {
      role: 'progressbar',
      'aria-valuemin': (s) => get(s).min,
      'aria-valuemax': (s) => get(s).max,
      'aria-valuenow': (s) => get(s).value ?? undefined,
      'aria-label': label,
      'data-state': (s) => valueState(get(s)),
      'data-orientation': (s) => get(s).orientation,
      'data-scope': 'progress',
      'data-part': 'root',
    },
    track: {
      'data-state': (s) => valueState(get(s)),
      'data-orientation': (s) => get(s).orientation,
      'data-scope': 'progress',
      'data-part': 'track',
    },
    range: {
      'data-state': (s) => valueState(get(s)),
      'data-orientation': (s) => get(s).orientation,
      'data-scope': 'progress',
      'data-part': 'range',
      style: (s) => rangeStyle(get(s)),
    },
    label: {
      'data-scope': 'progress',
      'data-part': 'label',
    },
    valueText: (s) => format(get(s).value, get(s).max),
  }
}

function defaultFormat(value: number | null, max: number): string {
  if (value === null) return en.progress.loading
  const pct = Math.round((value / max) * 100)
  return `${pct}%`
}

function rangeStyle(state: ProgressState): string {
  const p = percent(state)
  if (p === null) return ''
  const clamped = Math.max(0, Math.min(100, p))
  return state.orientation === 'horizontal' ? `width:${clamped}%;` : `height:${clamped}%;`
}

export const progress = { init, update, connect, percent, valueState }
