import type { Send } from '@llui/dom'

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
  readOnly: boolean
}

export type SignaturePadMsg =
  | { type: 'strokeStart'; x: number; y: number; pressure?: number }
  | { type: 'strokePoint'; x: number; y: number; pressure?: number }
  | { type: 'strokeEnd' }
  | { type: 'strokeCancel' }
  | { type: 'undo' }
  | { type: 'redo'; stroke: Stroke }
  | { type: 'clear' }
  | { type: 'setStrokes'; strokes: Stroke[] }

export interface SignaturePadInit {
  strokes?: Stroke[]
  disabled?: boolean
  readOnly?: boolean
}

export function init(opts: SignaturePadInit = {}): SignaturePadState {
  return {
    strokes: opts.strokes ?? [],
    current: null,
    drawing: false,
    disabled: opts.disabled ?? false,
    readOnly: opts.readOnly ?? false,
  }
}

function makePoint(x: number, y: number, pressure?: number): Point {
  return pressure !== undefined ? { x, y, pressure } : { x, y }
}

export function update(
  state: SignaturePadState,
  msg: SignaturePadMsg,
): [SignaturePadState, never[]] {
  if (state.disabled || state.readOnly) {
    // Allow reads (undo/clear are still useful for clearing a disabled pad).
    if (
      msg.type === 'strokeStart' ||
      msg.type === 'strokePoint' ||
      msg.type === 'strokeEnd'
    ) {
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
      const strokes =
        state.current.length > 1 ? [...state.strokes, state.current] : state.strokes
      return [{ ...state, strokes, current: null, drawing: false }, []]
    }
    case 'strokeCancel':
      return [{ ...state, current: null, drawing: false }, []]
    case 'undo': {
      if (state.strokes.length === 0) return [state, []]
      return [{ ...state, strokes: state.strokes.slice(0, -1) }, []]
    }
    case 'redo':
      return [{ ...state, strokes: [...state.strokes, msg.stroke] }, []]
    case 'clear':
      return [{ ...state, strokes: [], current: null, drawing: false }, []]
    case 'setStrokes':
      return [{ ...state, strokes: msg.strokes }, []]
  }
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

export interface SignaturePadParts<S> {
  root: {
    role: 'application'
    'aria-label': string
    'data-scope': 'signature-pad'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    'data-readonly': (s: S) => '' | undefined
    'data-drawing': (s: S) => '' | undefined
  }
  control: {
    'data-scope': 'signature-pad'
    'data-part': 'control'
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string
    disabled: (s: S) => boolean
    'data-scope': 'signature-pad'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  undoTrigger: {
    type: 'button'
    'aria-label': string
    disabled: (s: S) => boolean
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
    value: (s: S) => string
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

export function connect<S>(
  get: (s: S) => SignaturePadState,
  send: Send<SignaturePadMsg>,
  opts: ConnectOptions = {},
): SignaturePadParts<S> {
  return {
    root: {
      role: 'application',
      'aria-label': opts.label ?? 'Signature pad',
      'data-scope': 'signature-pad',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-readonly': (s) => (get(s).readOnly ? '' : undefined),
      'data-drawing': (s) => (get(s).drawing ? '' : undefined),
    },
    control: {
      'data-scope': 'signature-pad',
      'data-part': 'control',
    },
    clearTrigger: {
      type: 'button',
      'aria-label': opts.clearLabel ?? 'Clear signature',
      disabled: (s) => isEmpty(get(s)),
      'data-scope': 'signature-pad',
      'data-part': 'clear-trigger',
      onClick: () => send({ type: 'clear' }),
    },
    undoTrigger: {
      type: 'button',
      'aria-label': opts.undoLabel ?? 'Undo last stroke',
      disabled: (s) => get(s).strokes.length === 0,
      'data-scope': 'signature-pad',
      'data-part': 'undo-trigger',
      onClick: () => send({ type: 'undo' }),
    },
    guide: {
      'data-scope': 'signature-pad',
      'data-part': 'guide',
      'aria-hidden': 'true',
    },
    hiddenInput: {
      type: 'hidden',
      // Serialize strokes as JSON for form submission.
      value: (s) => JSON.stringify(get(s).strokes),
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
}
