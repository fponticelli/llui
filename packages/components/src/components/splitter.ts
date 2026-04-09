import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction'

/**
 * Splitter — resizable panes with a draggable handle. The handle's position
 * is expressed as a percentage of the container, stored as a number 0..100.
 * Supports keyboard arrow resize with a configurable step.
 */

export type Orientation = 'horizontal' | 'vertical'

export interface SplitterState {
  position: number
  min: number
  max: number
  step: number
  orientation: Orientation
  disabled: boolean
  dragging: boolean
}

export type SplitterMsg =
  | { type: 'setPosition'; position: number }
  | { type: 'increment'; multiplier?: number }
  | { type: 'decrement'; multiplier?: number }
  | { type: 'toMin' }
  | { type: 'toMax' }
  | { type: 'startDrag' }
  | { type: 'endDrag' }

export interface SplitterInit {
  position?: number
  min?: number
  max?: number
  step?: number
  orientation?: Orientation
  disabled?: boolean
}

export function init(opts: SplitterInit = {}): SplitterState {
  return {
    position: opts.position ?? 50,
    min: opts.min ?? 0,
    max: opts.max ?? 100,
    step: opts.step ?? 1,
    orientation: opts.orientation ?? 'horizontal',
    disabled: opts.disabled ?? false,
    dragging: false,
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function update(state: SplitterState, msg: SplitterMsg): [SplitterState, never[]] {
  if (state.disabled && msg.type !== 'endDrag') return [state, []]
  switch (msg.type) {
    case 'setPosition':
      return [{ ...state, position: clamp(msg.position, state.min, state.max) }, []]
    case 'increment': {
      const delta = state.step * (msg.multiplier ?? 1)
      return [{ ...state, position: clamp(state.position + delta, state.min, state.max) }, []]
    }
    case 'decrement': {
      const delta = state.step * (msg.multiplier ?? 1)
      return [{ ...state, position: clamp(state.position - delta, state.min, state.max) }, []]
    }
    case 'toMin':
      return [{ ...state, position: state.min }, []]
    case 'toMax':
      return [{ ...state, position: state.max }, []]
    case 'startDrag':
      return [{ ...state, dragging: true }, []]
    case 'endDrag':
      return [{ ...state, dragging: false }, []]
  }
}

/** Compute position percentage from a pointer event within a container rect. */
export function positionFromPoint(
  state: SplitterState,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): number {
  const pct =
    state.orientation === 'horizontal'
      ? ((clientX - rect.left) / rect.width) * 100
      : ((clientY - rect.top) / rect.height) * 100
  return clamp(pct, state.min, state.max)
}

export interface SplitterParts<S> {
  root: {
    'data-scope': 'splitter'
    'data-part': 'root'
    'data-orientation': (s: S) => Orientation
    'data-disabled': (s: S) => '' | undefined
    'data-dragging': (s: S) => '' | undefined
  }
  primaryPanel: {
    'data-scope': 'splitter'
    'data-part': 'primary-panel'
    style: (s: S) => string
  }
  secondaryPanel: {
    'data-scope': 'splitter'
    'data-part': 'secondary-panel'
    style: (s: S) => string
  }
  resizeTrigger: {
    role: 'separator'
    'aria-orientation': (s: S) => Orientation
    'aria-valuemin': (s: S) => number
    'aria-valuemax': (s: S) => number
    'aria-valuenow': (s: S) => number
    'aria-disabled': (s: S) => 'true' | undefined
    'data-scope': 'splitter'
    'data-part': 'resize-trigger'
    'data-orientation': (s: S) => Orientation
    tabIndex: (s: S) => number
    onKeyDown: (e: KeyboardEvent) => void
    onPointerDown: (e: PointerEvent) => void
  }
}

export function connect<S>(
  get: (s: S) => SplitterState,
  send: Send<SplitterMsg>,
): SplitterParts<S> {
  const sizeProp = (s: S, inverted: boolean): string => {
    const pos = get(s).position
    const axis = get(s).orientation === 'horizontal' ? 'width' : 'height'
    const pct = inverted ? 100 - pos : pos
    return `${axis}:${pct}%;`
  }

  return {
    root: {
      'data-scope': 'splitter',
      'data-part': 'root',
      'data-orientation': (s) => get(s).orientation,
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
    },
    primaryPanel: {
      'data-scope': 'splitter',
      'data-part': 'primary-panel',
      style: (s) => sizeProp(s, false),
    },
    secondaryPanel: {
      'data-scope': 'splitter',
      'data-part': 'secondary-panel',
      style: (s) => sizeProp(s, true),
    },
    resizeTrigger: {
      role: 'separator',
      'aria-orientation': (s) => get(s).orientation,
      'aria-valuemin': (s) => get(s).min,
      'aria-valuemax': (s) => get(s).max,
      'aria-valuenow': (s) => get(s).position,
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'splitter',
      'data-part': 'resize-trigger',
      'data-orientation': (s) => get(s).orientation,
      tabIndex: (s) => (get(s).disabled ? -1 : 0),
      onKeyDown: (e) => {
        const key = flipArrow(e.key, e.currentTarget as Element)
        switch (key) {
          case 'ArrowRight':
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'increment' })
            return
          case 'ArrowLeft':
          case 'ArrowUp':
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
        }
      },
      onPointerDown: (e) => {
        e.preventDefault()
        send({ type: 'startDrag' })
      },
    },
  }
}

export const splitter = { init, update, connect, positionFromPoint }
