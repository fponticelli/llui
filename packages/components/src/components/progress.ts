import type { Send, Signal } from '@llui/dom'
import { en } from '../locale.js'

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
  /** @humanOnly */
  | { type: 'setValue'; value: number | null }
  /** @humanOnly */
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

export interface ProgressParts {
  root: {
    role: 'progressbar'
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number | undefined>
    'aria-label': string | undefined
    'data-state': Signal<'indeterminate' | 'complete' | 'loading'>
    'data-orientation': Signal<ProgressOrientation>
    'data-scope': 'progress'
    'data-part': 'root'
  }
  track: {
    'data-state': Signal<'indeterminate' | 'complete' | 'loading'>
    'data-orientation': Signal<ProgressOrientation>
    'data-scope': 'progress'
    'data-part': 'track'
  }
  range: {
    'data-state': Signal<'indeterminate' | 'complete' | 'loading'>
    'data-orientation': Signal<ProgressOrientation>
    'data-scope': 'progress'
    'data-part': 'range'
    style: Signal<string>
  }
  label: {
    'data-scope': 'progress'
    'data-part': 'label'
  }
  valueText: Signal<string>
}

export interface ConnectOptions {
  label?: string
  /** Custom formatter for value text. */
  format?: (value: number | null, max: number) => string
}

export function connect(
  state: Signal<ProgressState>,
  _send: Send<ProgressMsg>,
  opts: ConnectOptions = {},
): ProgressParts {
  const label = opts.label
  const format = opts.format
  const valueText = (s: ProgressState): string =>
    format ? format(s.value, s.max) : defaultFormat(s)

  return {
    root: {
      role: 'progressbar',
      'aria-valuemin': state.map((s) => s.min),
      'aria-valuemax': state.map((s) => s.max),
      'aria-valuenow': state.map((s) => s.value ?? undefined),
      'aria-label': label,
      'data-state': state.map((s) => valueState(s)),
      'data-orientation': state.map((s) => s.orientation),
      'data-scope': 'progress',
      'data-part': 'root',
    },
    track: {
      'data-state': state.map((s) => valueState(s)),
      'data-orientation': state.map((s) => s.orientation),
      'data-scope': 'progress',
      'data-part': 'track',
    },
    range: {
      'data-state': state.map((s) => valueState(s)),
      'data-orientation': state.map((s) => s.orientation),
      'data-scope': 'progress',
      'data-part': 'range',
      style: state.map((s) => rangeStyle(s)),
    },
    label: {
      'data-scope': 'progress',
      'data-part': 'label',
    },
    valueText: state.map((s) => valueText(s)),
  }
}

function defaultFormat(state: ProgressState): string {
  const p = percent(state)
  if (p === null) return en.progress.loading
  return `${Math.round(p)}%`
}

function rangeStyle(state: ProgressState): string {
  const p = percent(state)
  if (p === null) return ''
  const clamped = Math.max(0, Math.min(100, p))
  return state.orientation === 'horizontal' ? `width:${clamped}%;` : `height:${clamped}%;`
}

export const progress = { init, update, connect, percent, valueState }
