import type { Send, ReadSignal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { allFiniteNumbers } from '../utils/number.js'
import { signaturePadLocale } from '../locale/signature-pad.js'

/**
 * Signature pad — capture free-form strokes on a canvas. The state
 * machine tracks strokes as arrays of points; the view renders them
 * onto a <canvas> element (consumer owns the canvas drawing, typically
 * by redrawing all strokes in an onMount effect whenever `state.strokes`
 * changes, or by drawing incrementally on each `addPoint` message).
 *
 * Pointer event wiring in the view layer:
 *
 *   onPointerDown: (e) => {
 *     canvas.setPointerCapture(e.pointerId)
 *     send({ type: 'strokeStart', x: e.offsetX, y: e.offsetY })
 *   }
 *   onPointerMove: (e) => {
 *     if (state.drawing) send({ type: 'strokePoint', x: e.offsetX, y: e.offsetY })
 *   }
 *   onPointerUp: () => send({ type: 'strokeEnd' })
 */

export interface Point {
  x: number
  y: number
  /** Pressure 0..1 (optional; from PointerEvent.pressure). */
  pressure?: number
}

export type Stroke = Point[]

export interface SignaturePadState {
  strokes: Stroke[]
  /** Stroke currently being drawn, or null. */
  current: Stroke | null
  drawing: boolean
  disabled: boolean
  readonly: boolean
  /**
   * The strokes the last `clear` removed, until the next edit — what makes a
   * destructive clear undoable (`undo` right after `clear` restores them).
   * `null` when there is nothing to restore (#266).
   */
  cleared: Stroke[] | null
}

export type SignaturePadMsg =
  /** @humanOnly */
  | { type: 'strokeStart'; x: number; y: number; pressure?: number }
  /** @humanOnly */
  | { type: 'strokePoint'; x: number; y: number; pressure?: number }
  /** @humanOnly */
  | { type: 'strokeEnd' }
  /** @humanOnly */
  | { type: 'strokeCancel' }
  /** @intent("Undo the last completed stroke") */
  | { type: 'undo' }
  /** @humanOnly */
  | { type: 'redo'; stroke: Stroke }
  /** @intent("Erase the entire signature") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'setStrokes'; strokes: Stroke[] }

export interface SignaturePadInit {
  strokes?: Stroke[]
  disabled?: boolean
  readonly?: boolean
}

export function init(opts: SignaturePadInit = {}): SignaturePadState {
  return {
    strokes: opts.strokes !== undefined && allFiniteNumbers(opts.strokes) ? opts.strokes : [],
    current: null,
    drawing: false,
    disabled: opts.disabled ?? false,
    readonly: opts.readonly ?? false,
    cleared: null,
  }
}

function makePoint(x: number, y: number, pressure?: number): Point {
  return pressure !== undefined ? { x, y, pressure } : { x, y }
}

export function update(
  state: SignaturePadState,
  msg: SignaturePadMsg,
): [SignaturePadState, never[]] {
  if (!allFiniteNumbers(msg)) return [state, []]
  if (state.disabled || state.readonly) {
    // Allow reads (undo/clear are still useful for clearing a disabled pad).
    if (msg.type === 'strokeStart' || msg.type === 'strokePoint' || msg.type === 'strokeEnd') {
      return [state, []]
    }
  }
  switch (msg.type) {
    case 'strokeStart': {
      const current = [makePoint(msg.x, msg.y, msg.pressure)]
      return [{ ...state, current, drawing: true }, []]
    }
    case 'strokePoint': {
      if (!state.drawing || state.current === null) return [state, []]
      const current = [...state.current, makePoint(msg.x, msg.y, msg.pressure)]
      return [{ ...state, current }, []]
    }
    case 'strokeEnd': {
      if (!state.drawing || state.current === null) return [state, []]
      // Drop 1-point strokes (accidental taps).
      if (state.current.length <= 1) {
        return [{ ...state, current: null, drawing: false }, []]
      }
      // A real new stroke is an edit: the cleared strokes are no longer what
      // "undo" should bring back.
      const strokes = [...state.strokes, state.current]
      return [{ ...state, strokes, current: null, drawing: false, cleared: null }, []]
    }
    case 'strokeCancel':
      return [{ ...state, current: null, drawing: false }, []]
    case 'undo': {
      if (state.strokes.length === 0) {
        // Undo of a destructive clear: restore everything it removed (#266).
        if (state.cleared === null) return [state, []]
        return [{ ...state, strokes: state.cleared, cleared: null }, []]
      }
      return [{ ...state, strokes: state.strokes.slice(0, -1) }, []]
    }
    case 'redo':
      return [{ ...state, strokes: [...state.strokes, msg.stroke], cleared: null }, []]
    case 'clear':
      return [
        {
          ...state,
          strokes: [],
          current: null,
          drawing: false,
          // Keep what was erased so `undo` can restore it; clearing an empty
          // pad has nothing to keep.
          cleared: state.strokes.length > 0 ? state.strokes : state.cleared,
        },
        [],
      ]
    case 'setStrokes':
      return [{ ...state, strokes: msg.strokes, cleared: null }, []]
  }
}

/** True when `undo` would change something: a stroke to remove or a clear to restore. */
export function canUndo(state: SignaturePadState): boolean {
  return state.strokes.length > 0 || state.cleared !== null
}

export function isEmpty(state: SignaturePadState): boolean {
  return state.strokes.length === 0 && state.current === null
}

/** Total number of points across all strokes + current. */
export function pointCount(state: SignaturePadState): number {
  let n = state.current?.length ?? 0
  for (const s of state.strokes) n += s.length
  return n
}

/**
 * Compute the axis-aligned bounding box of all strokes, or null if empty.
 * Useful for cropping the exported signature tightly.
 */
export function getBounds(
  state: SignaturePadState,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const all = state.current ? [...state.strokes, state.current] : state.strokes
  for (const stroke of all) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export interface SignaturePadParts {
  root: {
    role: 'application'
    'aria-label': string
    'data-scope': 'signature-pad'
    'data-part': 'root'
    'data-disabled': ReadSignal<'' | undefined>
    'data-readonly': ReadSignal<'' | undefined>
    'data-drawing': ReadSignal<'' | undefined>
    /** Present while nothing has been drawn — the placeholder hook. */
    'data-empty': ReadSignal<'' | undefined>
  }
  control: {
    'data-scope': 'signature-pad'
    'data-part': 'control'
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string
    disabled: ReadSignal<boolean>
    'data-scope': 'signature-pad'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  undoTrigger: {
    type: 'button'
    'aria-label': string
    disabled: ReadSignal<boolean>
    'data-scope': 'signature-pad'
    'data-part': 'undo-trigger'
    onClick: (e: MouseEvent) => void
  }
  guide: {
    'data-scope': 'signature-pad'
    'data-part': 'guide'
    'aria-hidden': 'true'
  }
  hiddenInput: {
    type: 'hidden'
    value: ReadSignal<string>
    name?: string
    'data-scope': 'signature-pad'
    'data-part': 'hidden-input'
  }
}

export interface ConnectOptions {
  label?: string
  clearLabel?: string
  undoLabel?: string
  name?: string
}

export function connect(
  state: ReadSignal<SignaturePadState>,
  send: Send<SignaturePadMsg>,
  opts: ConnectOptions = {},
): SignaturePadParts {
  const locale = signaturePadLocale()
  return {
    root: {
      role: 'application',
      'aria-label': opts.label ?? locale.label,
      'data-scope': 'signature-pad',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-readonly': state.map((s) => (s.readonly ? '' : undefined)),
      'data-drawing': state.map((s) => (s.drawing ? '' : undefined)),
      'data-empty': state.map((s) => (isEmpty(s) ? '' : undefined)),
    },
    control: {
      'data-scope': 'signature-pad',
      'data-part': 'control',
    },
    clearTrigger: {
      type: 'button',
      'aria-label': opts.clearLabel ?? locale.clear,
      disabled: state.map((s) => isEmpty(s)),
      'data-scope': 'signature-pad',
      'data-part': 'clear-trigger',
      onClick: tagSend(send, ['clear'], () => send({ type: 'clear' })),
    },
    undoTrigger: {
      type: 'button',
      'aria-label': opts.undoLabel ?? locale.undo,
      disabled: state.map((s) => !canUndo(s)),
      'data-scope': 'signature-pad',
      'data-part': 'undo-trigger',
      onClick: tagSend(send, ['undo'], () => send({ type: 'undo' })),
    },
    guide: {
      'data-scope': 'signature-pad',
      'data-part': 'guide',
      'aria-hidden': 'true',
    },
    hiddenInput: {
      type: 'hidden',
      // Serialize strokes as JSON for form submission.
      value: state.map((s) => JSON.stringify(s.strokes)),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      'data-scope': 'signature-pad',
      'data-part': 'hidden-input',
    },
  }
}

export const signaturePad = {
  init,
  update,
  connect,
  isEmpty,
  pointCount,
  getBounds,
  canUndo,
}
