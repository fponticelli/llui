import type { Send, ReadSignal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { floatingPanelLocale } from '../locale/floating-panel.js'
import { allFiniteNumbers, clamp, finiteBound, finiteOrDefault } from '../utils/number.js'

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
  /** @intent("Move the panel by a pixel offset (x right, y down)") */
  | { type: 'moveBy'; dx: number; dy: number }
  /** @intent("Resize the panel from one edge or corner by a pixel offset (clamped to min/max)") */
  | { type: 'resizeBy'; handle: ResizeHandle; dx: number; dy: number }

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
    position: {
      x: finiteOrDefault(opts.position?.x, 100),
      y: finiteOrDefault(opts.position?.y, 100),
    },
    size: {
      width: finiteOrDefault(opts.size?.width, 400),
      height: finiteOrDefault(opts.size?.height, 300),
    },
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
  if (!allFiniteNumbers(x, y, width, height)) return state
  const size = clampSize(width, height, state.minSize, state.maxSize)
  // If clamping changed width/height, undo the x/y shift by that delta.
  if (handle.includes('w')) x += width - size.width
  if (handle.includes('n')) y += height - size.height
  if (!allFiniteNumbers(x, y, size)) return state
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
      if (!allFiniteNumbers(msg.dx, msg.dy)) return [state, []]
      if (!allFiniteNumbers(state.position.x + msg.dx, state.position.y + msg.dy)) {
        return [state, []]
      }
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
      if (!allFiniteNumbers(msg.dx, msg.dy)) return [state, []]
      return [applyResize(state, msg.dx, msg.dy, state.resizing), []]
    case 'resizeEnd':
      return [{ ...state, resizing: null }, []]
    // The keyboard's move and resize (#266): the same geometry as the pointer
    // path, with no drag/resize "in progress" to start first. A maximized panel
    // refuses both, exactly as it refuses `dragStart`/`resizeStart`.
    case 'moveBy': {
      if (state.maximized) return [state, []]
      const x = state.position.x + msg.dx
      const y = state.position.y + msg.dy
      if (!allFiniteNumbers(x, y)) return [state, []]
      return [{ ...state, position: { x, y } }, []]
    }
    case 'resizeBy':
      if (state.maximized) return [state, []]
      if (!allFiniteNumbers(msg.dx, msg.dy)) return [state, []]
      return [applyResize(state, msg.dx, msg.dy, msg.handle), []]
    case 'setPosition':
      if (!allFiniteNumbers(msg.x, msg.y)) return [state, []]
      return [{ ...state, position: { x: msg.x, y: msg.y } }, []]
    case 'setSize': {
      if (!allFiniteNumbers(msg.width, msg.height)) return [state, []]
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
    'data-dragging': ReadSignal<'' | undefined>
    'data-resizing': ReadSignal<'' | undefined>
    'data-minimized': ReadSignal<'' | undefined>
    'data-maximized': ReadSignal<'' | undefined>
    hidden: ReadSignal<boolean>
    style: ReadSignal<string>
  }
  /**
   * Pointer drag starts here, and it is also a keyboard stop (#266): arrows
   * move the panel 10px (50px with Shift). Physical under RTL — the panel is
   * positioned with physical `left`/`top`.
   */
  dragHandle: {
    /**
     * A focusable, NAMED group: without a role an `aria-label` is prohibited
     * on a generic element and assistive tech announced nothing (#268 audit).
     * `group`, not `button`: the handle is the title bar and CONTAINS the
     * minimize/maximize/close buttons (a button may not), and its action is
     * the arrow keys `aria-keyshortcuts` names, not an activation.
     */
    role: 'group'
    tabindex: 0
    'aria-label': string
    'aria-keyshortcuts': string
    'data-scope': 'floating-panel'
    'data-part': 'drag-handle'
    onPointerDown: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  content: {
    'data-scope': 'floating-panel'
    'data-part': 'content'
    hidden: ReadSignal<boolean>
  }
  minimizeTrigger: {
    type: 'button'
    'aria-label': string
    /** A toggle: `'true'` while minimized. */
    'aria-pressed': ReadSignal<'true' | 'false'>
    'data-scope': 'floating-panel'
    'data-part': 'minimize-trigger'
    onClick: (e: MouseEvent) => void
  }
  maximizeTrigger: {
    type: 'button'
    'aria-label': string
    /** A toggle: `'true'` while maximized. */
    'aria-pressed': ReadSignal<'true' | 'false'>
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
  /** A resize grip; also a keyboard stop whose arrows resize from this grip (#266). */
  resizeHandle: (handle: ResizeHandle) => {
    /** A focusable, named group (see `dragHandle`): its action is the arrow
     *  keys, and a thin edge grip is a window-chrome affordance, not a
     *  pointer button. */
    role: 'group'
    tabindex: 0
    'aria-label': string
    'aria-keyshortcuts': string
    'data-scope': 'floating-panel'
    'data-part': 'resize-handle'
    'data-handle': ResizeHandle
    onPointerDown: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export interface ConnectOptions {
  label?: string
  minimizeLabel?: string
  maximizeLabel?: string
  closeLabel?: string
  moveLabel?: string
  resizeLabel?: string
}

/** Pixel step of one arrow press; Shift uses the large step. */
const KEY_STEP = 10
const KEY_STEP_LARGE = 50
const ARROW_KEYS =
  'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown'

/** The physical `[dx, dy]` of an arrow press, or undefined for any other key. */
function arrowDelta(e: KeyboardEvent): readonly [number, number] | undefined {
  const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
  switch (e.key) {
    case 'ArrowLeft':
      return [-step, 0]
    case 'ArrowRight':
      return [step, 0]
    case 'ArrowUp':
      return [0, -step]
    case 'ArrowDown':
      return [0, step]
    default:
      return undefined
  }
}

export function connect(
  state: ReadSignal<FloatingPanelState>,
  send: Send<FloatingPanelMsg>,
  opts: ConnectOptions = {},
): FloatingPanelParts {
  const locale = floatingPanelLocale()
  return {
    root: {
      role: 'dialog',
      'aria-label': opts.label ?? locale.label,
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
      role: 'group',
      tabindex: 0,
      'aria-label': opts.moveLabel ?? locale.move,
      'aria-keyshortcuts': ARROW_KEYS,
      'data-scope': 'floating-panel',
      'data-part': 'drag-handle',
      onPointerDown: tagSend(send, ['dragStart'], () => send({ type: 'dragStart' })),
      onKeyDown: tagSend(send, ['moveBy'], (e) => {
        const delta = arrowDelta(e)
        if (delta === undefined) return
        e.preventDefault()
        send({ type: 'moveBy', dx: delta[0], dy: delta[1] })
      }),
    },
    content: {
      'data-scope': 'floating-panel',
      'data-part': 'content',
      hidden: state.map((st) => st.minimized),
    },
    minimizeTrigger: {
      type: 'button',
      'aria-label': opts.minimizeLabel ?? locale.minimize,
      'data-scope': 'floating-panel',
      'data-part': 'minimize-trigger',
      'aria-pressed': state.map((st) => (st.minimized ? 'true' : 'false')),
      onClick: tagSend(send, ['toggleMinimize'], () => send({ type: 'toggleMinimize' })),
    },
    maximizeTrigger: {
      type: 'button',
      'aria-label': opts.maximizeLabel ?? locale.maximize,
      'data-scope': 'floating-panel',
      'data-part': 'maximize-trigger',
      'aria-pressed': state.map((st) => (st.maximized ? 'true' : 'false')),
      onClick: tagSend(send, ['toggleMaximize'], () => send({ type: 'toggleMaximize' })),
    },
    closeTrigger: {
      type: 'button',
      'aria-label': opts.closeLabel ?? locale.close,
      'data-scope': 'floating-panel',
      'data-part': 'close-trigger',
      onClick: tagSend(send, ['close'], () => send({ type: 'close' })),
    },
    resizeHandle: (handle: ResizeHandle) => ({
      role: 'group',
      tabindex: 0,
      'aria-label': opts.resizeLabel ?? locale.resize,
      'aria-keyshortcuts': ARROW_KEYS,
      'data-scope': 'floating-panel',
      'data-part': 'resize-handle',
      'data-handle': handle,
      onPointerDown: tagSend(send, ['resizeStart'], () => send({ type: 'resizeStart', handle })),
      onKeyDown: tagSend(send, ['resizeBy'], (e) => {
        const delta = arrowDelta(e)
        if (delta === undefined) return
        e.preventDefault()
        send({ type: 'resizeBy', handle, dx: delta[0], dy: delta[1] })
      }),
    }),
  }
}

export const floatingPanel = { init, update, connect }
