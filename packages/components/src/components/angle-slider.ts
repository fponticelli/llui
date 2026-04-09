import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction'

/**
 * Angle slider — a circular input that selects a value in 0..360 degrees
 * by dragging a thumb around a control. The state machine tracks the
 * current angle; the view layer computes angles from pointer positions
 * (helpers exported for that purpose).
 *
 * Typical view wiring: on pointerdown/pointermove, read the control
 * element's bounding rect, compute the angle from `(pointerX, pointerY)`
 * to the rect center via `angleFromPoint()`, and dispatch `setValue`.
 *
 * Keyboard: Arrow keys adjust by `step`; Home/End jump to min/max;
 * PageUp/PageDown adjust by `step * 10`.
 */

export interface AngleSliderState {
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  readOnly: boolean
}

export type AngleSliderMsg =
  | { type: 'setValue'; value: number }
  | { type: 'increment'; steps?: number }
  | { type: 'decrement'; steps?: number }
  | { type: 'setMin'; min: number }
  | { type: 'setMax'; max: number }

export interface AngleSliderInit {
  value?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  readOnly?: boolean
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function roundToStep(value: number, step: number, min: number): number {
  if (step <= 0) return value
  return min + Math.round((value - min) / step) * step
}

export function init(opts: AngleSliderInit = {}): AngleSliderState {
  const min = opts.min ?? 0
  const max = opts.max ?? 360
  const step = opts.step ?? 1
  return {
    value: clamp(roundToStep(opts.value ?? 0, step, min), min, max),
    min,
    max,
    step,
    disabled: opts.disabled ?? false,
    readOnly: opts.readOnly ?? false,
  }
}

export function update(state: AngleSliderState, msg: AngleSliderMsg): [AngleSliderState, never[]] {
  if (state.disabled || state.readOnly) {
    if (msg.type === 'setValue' || msg.type === 'increment' || msg.type === 'decrement') {
      return [state, []]
    }
  }
  switch (msg.type) {
    case 'setValue': {
      const v = clamp(roundToStep(msg.value, state.step, state.min), state.min, state.max)
      return [{ ...state, value: v }, []]
    }
    case 'increment': {
      const steps = msg.steps ?? 1
      const v = clamp(state.value + state.step * steps, state.min, state.max)
      return [{ ...state, value: v }, []]
    }
    case 'decrement': {
      const steps = msg.steps ?? 1
      const v = clamp(state.value - state.step * steps, state.min, state.max)
      return [{ ...state, value: v }, []]
    }
    case 'setMin':
      return [{ ...state, min: msg.min, value: clamp(state.value, msg.min, state.max) }, []]
    case 'setMax':
      return [{ ...state, max: msg.max, value: clamp(state.value, state.min, msg.max) }, []]
  }
}

/**
 * Compute the angle in degrees from the center of a rect to a point.
 * 0° = up (12 o'clock), increases clockwise. Result is in 0..360.
 *
 * Useful inside a pointermove handler:
 *   const rect = control.getBoundingClientRect()
 *   const angle = angleFromPoint(rect, e.clientX, e.clientY)
 *   send({ type: 'setValue', value: angle })
 */
export function angleFromPoint(rect: DOMRect, x: number, y: number): number {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = x - cx
  const dy = y - cy
  // atan2 gives 0° at east growing counter-clockwise; we want 0° at north
  // growing clockwise, so rotate by 90° and negate.
  const rad = Math.atan2(dy, dx)
  let deg = (rad * 180) / Math.PI + 90
  if (deg < 0) deg += 360
  return deg % 360
}

/** Convert an angle to (x, y) on a unit circle (radius 1 at origin). */
export function pointFromAngle(angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: Math.cos(rad), y: Math.sin(rad) }
}

export interface AngleSliderParts<S> {
  root: {
    role: 'slider'
    'aria-valuemin': (s: S) => number
    'aria-valuemax': (s: S) => number
    'aria-valuenow': (s: S) => number
    'aria-valuetext': (s: S) => string
    'aria-orientation': 'horizontal'
    'aria-disabled': (s: S) => 'true' | undefined
    'aria-readonly': (s: S) => 'true' | undefined
    tabIndex: (s: S) => number
    'data-scope': 'angle-slider'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    onKeyDown: (e: KeyboardEvent) => void
  }
  control: {
    'data-scope': 'angle-slider'
    'data-part': 'control'
  }
  /**
   * The draggable thumb element. Its position is typically computed via
   * CSS custom properties `--angle` (0..360) that the consumer sets from
   * `state.value` using pointFromAngle() or a CSS `transform: rotate()`.
   */
  thumb: {
    'data-scope': 'angle-slider'
    'data-part': 'thumb'
    'data-value': (s: S) => string
  }
  valueText: {
    'data-scope': 'angle-slider'
    'data-part': 'value-text'
  }
  /** A hidden input for form participation. */
  hiddenInput: {
    type: 'hidden'
    value: (s: S) => string
    name?: string
    'data-scope': 'angle-slider'
    'data-part': 'hidden-input'
  }
}

export interface ConnectOptions {
  /** Name for the hidden input (form integration). */
  name?: string
  /** Formatter for aria-valuetext (default: "{value}°"). */
  format?: (value: number) => string
}

export function connect<S>(
  get: (s: S) => AngleSliderState,
  send: Send<AngleSliderMsg>,
  opts: ConnectOptions = {},
): AngleSliderParts<S> {
  const fmt = opts.format ?? ((v: number) => `${Math.round(v)}°`)

  return {
    root: {
      role: 'slider',
      'aria-valuemin': (s) => get(s).min,
      'aria-valuemax': (s) => get(s).max,
      'aria-valuenow': (s) => get(s).value,
      'aria-valuetext': (s) => fmt(get(s).value),
      'aria-orientation': 'horizontal',
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'aria-readonly': (s) => (get(s).readOnly ? 'true' : undefined),
      tabIndex: (s) => (get(s).disabled ? -1 : 0),
      'data-scope': 'angle-slider',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      onKeyDown: (e) => {
        const key = flipArrow(e.key, e.currentTarget as Element)
        switch (key) {
          case 'ArrowRight':
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'increment' })
            return
          case 'ArrowLeft':
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'decrement' })
            return
          case 'PageUp':
            e.preventDefault()
            send({ type: 'increment', steps: 10 })
            return
          case 'PageDown':
            e.preventDefault()
            send({ type: 'decrement', steps: 10 })
            return
          case 'Home':
            e.preventDefault()
            send({ type: 'setValue', value: -Infinity })
            return
          case 'End':
            e.preventDefault()
            send({ type: 'setValue', value: Infinity })
            return
        }
      },
    },
    control: {
      'data-scope': 'angle-slider',
      'data-part': 'control',
    },
    thumb: {
      'data-scope': 'angle-slider',
      'data-part': 'thumb',
      'data-value': (s) => String(get(s).value),
    },
    valueText: {
      'data-scope': 'angle-slider',
      'data-part': 'value-text',
    },
    hiddenInput: {
      type: 'hidden',
      value: (s) => String(get(s).value),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      'data-scope': 'angle-slider',
      'data-part': 'hidden-input',
    },
  }
}

export const angleSlider = { init, update, connect, angleFromPoint, pointFromAngle }
