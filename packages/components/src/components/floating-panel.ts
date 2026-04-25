import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

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
  maxSize: { width: number; height: number } | null
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
  /** @intent("Open") */
  | { type: 'open' }
  /** @intent("Close") */
  | { type: 'close' }
  /** @intent("Minimize") */
  | { type: 'minimize' }
  /** @intent("Restore From Minimized") */
  | { type: 'restoreFromMinimized' }
  /** @intent("Maximize") */
  | { type: 'maximize' }
  /** @intent("Restore From Maximized") */
  | { type: 'restoreFromMaximized' }
  /** @intent("Toggle Minimize") */
  | { type: 'toggleMinimize' }
  /** @intent("Toggle Maximize") */
  | { type: 'toggleMaximize' }
  /** @intent("Drag Start") */
  | { type: 'dragStart' }
  /** @intent("Drag Move") */
  | { type: 'dragMove'; dx: number; dy: number }
  /** @intent("Drag End") */
  | { type: 'dragEnd' }
  /** @intent("Resize Start") */
  | { type: 'resizeStart'; handle: ResizeHandle }
  /** @intent("Resize Move") */
  | { type: 'resizeMove'; dx: number; dy: number }
  /** @intent("Resize End") */
  | { type: 'resizeEnd' }
  /** @intent("Set Position") */
  | { type: 'setPosition'; x: number; y: number }
  /** @intent("Set Size") */
  | { type: 'setSize'; width: number; height: number }

export interface FloatingPanelInit {
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  minSize?: { width: number; height: number }
  maxSize?: { width: number; height: number } | null
  open?: boolean
  disabled?: boolean
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function init(opts: FloatingPanelInit = {}): FloatingPanelState {
  return {
    position: opts.position ?? { x: 100, y: 100 },
    size: opts.size ?? { width: 400, height: 300 },
    minSize: opts.minSize ?? { width: 200, height: 150 },
    maxSize: opts.maxSize ?? null,
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

export interface FloatingPanelParts<S> {
  root: {
    role: 'dialog'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'floating-panel'
    'data-part': 'root'
    'data-dragging': (s: S) => '' | undefined
    'data-resizing': (s: S) => '' | undefined
    'data-minimized': (s: S) => '' | undefined
    'data-maximized': (s: S) => '' | undefined
    hidden: (s: S) => boolean
    style: (s: S) => string
  }
  dragHandle: {
    'data-scope': 'floating-panel'
    'data-part': 'drag-handle'
    onPointerDown: (e: PointerEvent) => void
  }
  content: {
    'data-scope': 'floating-panel'
    'data-part': 'content'
    hidden: (s: S) => boolean
  }
  minimizeTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'floating-panel'
    'data-part': 'minimize-trigger'
    onClick: (e: MouseEvent) => void
  }
  maximizeTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'floating-panel'
    'data-part': 'maximize-trigger'
    onClick: (e: MouseEvent) => void
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
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

export function connect<S>(
  get: (s: S) => FloatingPanelState,
  send: Send<FloatingPanelMsg>,
  opts: ConnectOptions = {},
): FloatingPanelParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  return {
    root: {
      role: 'dialog',
      'aria-label': opts.label ?? ((s: S) => locale(s).floatingPanel.label),
      'data-scope': 'floating-panel',
      'data-part': 'root',
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      'data-resizing': (s) => (get(s).resizing !== null ? '' : undefined),
      'data-minimized': (s) => (get(s).minimized ? '' : undefined),
      'data-maximized': (s) => (get(s).maximized ? '' : undefined),
      hidden: (s) => !get(s).open,
      style: (s) => {
        const st = get(s)
        if (st.maximized) return 'position:fixed;inset:0;width:auto;height:auto;'
        return (
          `position:fixed;` +
          `left:${st.position.x}px;top:${st.position.y}px;` +
          `width:${st.size.width}px;height:${st.size.height}px;`
        )
      },
    },
    dragHandle: {
      'data-scope': 'floating-panel',
      'data-part': 'drag-handle',
      onPointerDown: () => send({ type: 'dragStart' }),
    },
    content: {
      'data-scope': 'floating-panel',
      'data-part': 'content',
      hidden: (s) => get(s).minimized,
    },
    minimizeTrigger: {
      type: 'button',
      'aria-label': opts.minimizeLabel ?? ((s: S) => locale(s).floatingPanel.minimize),
      'data-scope': 'floating-panel',
      'data-part': 'minimize-trigger',
      onClick: () => send({ type: 'toggleMinimize' }),
    },
    maximizeTrigger: {
      type: 'button',
      'aria-label': opts.maximizeLabel ?? ((s: S) => locale(s).floatingPanel.maximize),
      'data-scope': 'floating-panel',
      'data-part': 'maximize-trigger',
      onClick: () => send({ type: 'toggleMaximize' }),
    },
    closeTrigger: {
      type: 'button',
      'aria-label': opts.closeLabel ?? ((s: S) => locale(s).floatingPanel.close),
      'data-scope': 'floating-panel',
      'data-part': 'close-trigger',
      onClick: () => send({ type: 'close' }),
    },
    resizeHandle: (handle: ResizeHandle) => ({
      'data-scope': 'floating-panel',
      'data-part': 'resize-handle',
      'data-handle': handle,
      onPointerDown: () => send({ type: 'resizeStart', handle }),
    }),
  }
}

export const floatingPanel = { init, update, connect }
