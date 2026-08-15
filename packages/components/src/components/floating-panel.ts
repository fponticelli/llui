import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { clamp, finiteBound } from '../utils/number.js'

/**
 * Floating panel — a draggable + resizable window-like surface, useful
 * for dev tools overlays, pop-out inspectors, preview panels, etc. The
 * state machine tracks position and size; the view layer wires pointer
 * events on the drag handle and resize grips and dispatches the
 * corresponding messages.
 *
 * Coordinates are in pixels relative to the positioning container
 * (typically `position: fixed` relative to the viewport).
 */

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface FloatingPanelState {
  position: { x: number; y: number }
  size: { width: number; height: number }
  minSize: { width: number; height: number }
  /**
   * The upper size bound. `null` — or an absent dimension — is unbounded on
   * that axis, which is what `clampSize` already spelled `?? Infinity` at the
   * point of use. A bound in state is finite or absent, never an infinity
   * (`JSON.stringify` writes `null` for one) and never `NaN` (which is not
   * nullish, so it survives the `??` and switches that axis's clamp off) —
   * #177.
   */
  maxSize: { width?: number; height?: number } | null
  open: boolean
  minimized: boolean
  maximized: boolean
  dragging: boolean
  resizing: ResizeHandle | null
  /** Snapshot of the pre-maximize geometry (for restore). */
  restoreBounds: { x: number; y: number; width: number; height: number } | null
  disabled: boolean
}

export type FloatingPanelMsg =
  /** @intent("Open the floating panel") */
  | { type: 'open' }
  /** @intent("Close the floating panel") */
  | { type: 'close' }
  /** @intent("Minimize the panel (collapses to title bar)") */
  | { type: 'minimize' }
  /** @intent("Restore the panel from its minimized state") */
  | { type: 'restoreFromMinimized' }
  /** @intent("Maximize the panel (fills the viewport)") */
  | { type: 'maximize' }
  /** @intent("Restore the panel to its pre-maximize geometry") */
  | { type: 'restoreFromMaximized' }
  /** @intent("Toggle between minimized and normal") */
  | { type: 'toggleMinimize' }
  /** @intent("Toggle between maximized and normal") */
  | { type: 'toggleMaximize' }
  /** @humanOnly */
  | { type: 'dragStart' }
  /** @humanOnly */
  | { type: 'dragMove'; dx: number; dy: number }
  /** @humanOnly */
  | { type: 'dragEnd' }
  /** @humanOnly */
  | { type: 'resizeStart'; handle: ResizeHandle }
  /** @humanOnly */
  | { type: 'resizeMove'; dx: number; dy: number }
  /** @humanOnly */
  | { type: 'resizeEnd' }
  /** @intent("Set the panel's top-left position in pixels") */
  | { type: 'setPosition'; x: number; y: number }
  /** @intent("Set the panel's size in pixels (clamped to min/max)") */
  | { type: 'setSize'; width: number; height: number }

export interface FloatingPanelInit {
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  minSize?: { width?: number; height?: number }
  maxSize?: { width?: number; height?: number } | null
  open?: boolean
  disabled?: boolean
}

/**
 * Normalise an upper size bound into what state may hold: each axis kept only
 * when it is a finite number, the key OMITTED otherwise so the value round-trips
 * through JSON unchanged (setting it to `undefined` would rehydrate as a MISSING
 * key and differ from the live object by a key).
 */
function finiteSize(
  raw: { width?: number; height?: number } | null | undefined,
): { width?: number; height?: number } | null {
  if (raw == null) return null
  const width = finiteBound(raw.width)
  const height = finiteBound(raw.height)
  if (width === undefined && height === undefined) return null
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  }
}

export function init(opts: FloatingPanelInit = {}): FloatingPanelState {
  return {
    position: opts.position ?? { x: 100, y: 100 },
    size: opts.size ?? { width: 400, height: 300 },
    // Both size bounds are normalised per AXIS (#177): `minSize` is required,
    // so an unusable dimension takes the default, while `maxSize` is
    // unbounded-capable, so an unusable dimension is simply omitted — the same
    // absence `clampSize` expands to `Infinity`. A whole `maxSize` with no
    // usable dimension left is `null`, the canonical "no maximum".
    minSize: {
      width: finiteBound(opts.minSize?.width) ?? 200,
      height: finiteBound(opts.minSize?.height) ?? 150,
    },
    maxSize: finiteSize(opts.maxSize),
    open: opts.open ?? true,
    minimized: false,
    maximized: false,
    dragging: false,
    resizing: null,
    restoreBounds: null,
    disabled: opts.disabled ?? false,
  }
}

function clampSize(
  width: number,
  height: number,
  min: FloatingPanelState['minSize'],
  max: FloatingPanelState['maxSize'],
): { width: number; height: number } {
  const maxW = max?.width ?? Infinity
  const maxH = max?.height ?? Infinity
  return {
    width: clamp(width, min.width, maxW),
    height: clamp(height, min.height, maxH),
  }
}

function applyResize(
  state: FloatingPanelState,
  dx: number,
  dy: number,
  handle: ResizeHandle,
): FloatingPanelState {
  let { x, y } = state.position
  let { width, height } = state.size
  if (handle.includes('e')) width += dx
  if (handle.includes('w')) {
    width -= dx
    x += dx
  }
  if (handle.includes('s')) height += dy
  if (handle.includes('n')) {
    height -= dy
    y += dy
  }
  const size = clampSize(width, height, state.minSize, state.maxSize)
  // If clamping changed width/height, undo the x/y shift by that delta.
  if (handle.includes('w')) x += width - size.width
  if (handle.includes('n')) y += height - size.height
  return { ...state, position: { x, y }, size }
}

export function update(
  state: FloatingPanelState,
  msg: FloatingPanelMsg,
): [FloatingPanelState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'open':
      return [{ ...state, open: true }, []]
    case 'close':
      return [{ ...state, open: false, dragging: false, resizing: null }, []]
    case 'minimize':
      return [{ ...state, minimized: true, dragging: false, resizing: null }, []]
    case 'restoreFromMinimized':
      return [{ ...state, minimized: false }, []]
    case 'toggleMinimize':
      return [{ ...state, minimized: !state.minimized }, []]
    case 'maximize': {
      if (state.maximized) return [state, []]
      return [
        {
          ...state,
          maximized: true,
          restoreBounds: {
            x: state.position.x,
            y: state.position.y,
            width: state.size.width,
            height: state.size.height,
          },
        },
        [],
      ]
    }
    case 'restoreFromMaximized': {
      if (!state.maximized || !state.restoreBounds) {
        return [{ ...state, maximized: false }, []]
      }
      const b = state.restoreBounds
      return [
        {
          ...state,
          maximized: false,
          position: { x: b.x, y: b.y },
          size: { width: b.width, height: b.height },
          restoreBounds: null,
        },
        [],
      ]
    }
    case 'toggleMaximize':
      return update(state, {
        type: state.maximized ? 'restoreFromMaximized' : 'maximize',
      })
    case 'dragStart':
      if (state.maximized) return [state, []]
      return [{ ...state, dragging: true }, []]
    case 'dragMove':
      if (!state.dragging) return [state, []]
      return [
        {
          ...state,
          position: {
            x: state.position.x + msg.dx,
            y: state.position.y + msg.dy,
          },
        },
        [],
      ]
    case 'dragEnd':
      return [{ ...state, dragging: false }, []]
    case 'resizeStart':
      if (state.maximized) return [state, []]
      return [{ ...state, resizing: msg.handle }, []]
    case 'resizeMove':
      if (state.resizing === null) return [state, []]
      return [applyResize(state, msg.dx, msg.dy, state.resizing), []]
    case 'resizeEnd':
      return [{ ...state, resizing: null }, []]
    case 'setPosition':
      return [{ ...state, position: { x: msg.x, y: msg.y } }, []]
    case 'setSize': {
      const size = clampSize(msg.width, msg.height, state.minSize, state.maxSize)
      return [{ ...state, size }, []]
    }
  }
}

export interface FloatingPanelParts {
  root: {
    role: 'dialog'
    'aria-label': string
    'data-scope': 'floating-panel'
    'data-part': 'root'
    'data-dragging': Signal<'' | undefined>
    'data-resizing': Signal<'' | undefined>
    'data-minimized': Signal<'' | undefined>
    'data-maximized': Signal<'' | undefined>
    hidden: Signal<boolean>
    style: Signal<string>
  }
  dragHandle: {
    'data-scope': 'floating-panel'
    'data-part': 'drag-handle'
    onPointerDown: (e: PointerEvent) => void
  }
  content: {
    'data-scope': 'floating-panel'
    'data-part': 'content'
    hidden: Signal<boolean>
  }
  minimizeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'floating-panel'
    'data-part': 'minimize-trigger'
    onClick: (e: MouseEvent) => void
  }
  maximizeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'floating-panel'
    'data-part': 'maximize-trigger'
    onClick: (e: MouseEvent) => void
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'floating-panel'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
  resizeHandle: (handle: ResizeHandle) => {
    'data-scope': 'floating-panel'
    'data-part': 'resize-handle'
    'data-handle': ResizeHandle
    onPointerDown: (e: PointerEvent) => void
  }
}

export interface ConnectOptions {
  label?: string
  minimizeLabel?: string
  maximizeLabel?: string
  closeLabel?: string
}

export function connect(
  state: Signal<FloatingPanelState>,
  send: Send<FloatingPanelMsg>,
  opts: ConnectOptions = {},
): FloatingPanelParts {
  const locale = useContext(LocaleContext)
  return {
    root: {
      role: 'dialog',
      'aria-label': opts.label ?? locale.floatingPanel.label,
      'data-scope': 'floating-panel',
      'data-part': 'root',
      'data-dragging': state.map((st) => (st.dragging ? '' : undefined)),
      'data-resizing': state.map((st) => (st.resizing !== null ? '' : undefined)),
      'data-minimized': state.map((st) => (st.minimized ? '' : undefined)),
      'data-maximized': state.map((st) => (st.maximized ? '' : undefined)),
      hidden: state.map((st) => !st.open),
      style: state.map((st) => {
        if (st.maximized) return 'position:fixed;inset:0;width:auto;height:auto;'
        return (
          `position:fixed;` +
          `left:${st.position.x}px;top:${st.position.y}px;` +
          `width:${st.size.width}px;height:${st.size.height}px;`
        )
      }),
    },
    dragHandle: {
      'data-scope': 'floating-panel',
      'data-part': 'drag-handle',
      onPointerDown: tagSend(send, ['dragStart'], () => send({ type: 'dragStart' })),
    },
    content: {
      'data-scope': 'floating-panel',
      'data-part': 'content',
      hidden: state.map((st) => st.minimized),
    },
    minimizeTrigger: {
      type: 'button',
      'aria-label': opts.minimizeLabel ?? locale.floatingPanel.minimize,
      'data-scope': 'floating-panel',
      'data-part': 'minimize-trigger',
      onClick: tagSend(send, ['toggleMinimize'], () => send({ type: 'toggleMinimize' })),
    },
    maximizeTrigger: {
      type: 'button',
      'aria-label': opts.maximizeLabel ?? locale.floatingPanel.maximize,
      'data-scope': 'floating-panel',
      'data-part': 'maximize-trigger',
      onClick: tagSend(send, ['toggleMaximize'], () => send({ type: 'toggleMaximize' })),
    },
    closeTrigger: {
      type: 'button',
      'aria-label': opts.closeLabel ?? locale.floatingPanel.close,
      'data-scope': 'floating-panel',
      'data-part': 'close-trigger',
      onClick: tagSend(send, ['close'], () => send({ type: 'close' })),
    },
    resizeHandle: (handle: ResizeHandle) => ({
      'data-scope': 'floating-panel',
      'data-part': 'resize-handle',
      'data-handle': handle,
      onPointerDown: tagSend(send, ['resizeStart'], () => send({ type: 'resizeStart', handle })),
    }),
  }
}

export const floatingPanel = { init, update, connect }
