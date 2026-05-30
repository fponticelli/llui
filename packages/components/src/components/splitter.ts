import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'

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
  /** @intent("Set the splitter handle position (0–100, clamped to min/max)") */
  | { type: 'setPosition'; position: number }
  /** @intent("Move the handle by step (or step × multiplier) toward max") */
  | { type: 'increment'; multiplier?: number }
  /** @intent("Move the handle by step (or step × multiplier) toward min") */
  | { type: 'decrement'; multiplier?: number }
  /** @intent("Snap the handle to its minimum position") */
  | { type: 'toMin' }
  /** @intent("Snap the handle to its maximum position") */
  | { type: 'toMax' }
  /** @humanOnly */
  | { type: 'startDrag' }
  /** @humanOnly */
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

export interface SplitterParts {
  root: {
    'data-scope': 'splitter'
    'data-part': 'root'
    'data-orientation': Signal<Orientation>
    'data-disabled': Signal<'' | undefined>
    'data-dragging': Signal<'' | undefined>
  }
  primaryPanel: {
    'data-scope': 'splitter'
    'data-part': 'primary-panel'
    style: Signal<string>
  }
  secondaryPanel: {
    'data-scope': 'splitter'
    'data-part': 'secondary-panel'
    style: Signal<string>
  }
  resizeTrigger: {
    role: 'separator'
    'aria-orientation': Signal<Orientation>
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number>
    'aria-disabled': Signal<'true' | undefined>
    'data-scope': 'splitter'
    'data-part': 'resize-trigger'
    'data-orientation': Signal<Orientation>
    tabIndex: Signal<number>
    onKeyDown: (e: KeyboardEvent) => void
    onPointerDown: (e: PointerEvent) => void
  }
}

export function connect(state: Signal<SplitterState>, send: Send<SplitterMsg>): SplitterParts {
  const sizeProp = (s: SplitterState, inverted: boolean): string => {
    const pos = s.position
    const axis = s.orientation === 'horizontal' ? 'width' : 'height'
    const pct = inverted ? 100 - pos : pos
    return `${axis}:${pct}%;`
  }

  return {
    root: {
      'data-scope': 'splitter',
      'data-part': 'root',
      'data-orientation': state.map((s) => s.orientation),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-dragging': state.map((s) => (s.dragging ? '' : undefined)),
    },
    primaryPanel: {
      'data-scope': 'splitter',
      'data-part': 'primary-panel',
      style: state.map((s) => sizeProp(s, false)),
    },
    secondaryPanel: {
      'data-scope': 'splitter',
      'data-part': 'secondary-panel',
      style: state.map((s) => sizeProp(s, true)),
    },
    resizeTrigger: {
      role: 'separator',
      'aria-orientation': state.map((s) => s.orientation),
      'aria-valuemin': state.map((s) => s.min),
      'aria-valuemax': state.map((s) => s.max),
      'aria-valuenow': state.map((s) => s.position),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'data-scope': 'splitter',
      'data-part': 'resize-trigger',
      'data-orientation': state.map((s) => s.orientation),
      tabIndex: state.map((s) => (s.disabled ? -1 : 0)),
      onKeyDown: tagSend(send, ['increment', 'decrement', 'toMin', 'toMax'], (e) => {
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
      }),
      onPointerDown: tagSend(send, ['startDrag'], (e) => {
        e.preventDefault()
        send({ type: 'startDrag' })
      }),
    },
  }
}

export const splitter = { init, update, connect, positionFromPoint }
