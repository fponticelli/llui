// Drawing overlay for rect annotations — authored with @llui/dom.
//
// Mounts a full-viewport transparent layer (its own independent LLui root)
// that intercepts pointer events and draws the in-progress rectangle as an
// SVG rect bound to state. On mouseup the overlay STAYS VISIBLE (pointer-
// events disabled) so the user can see the selection while the modal asks
// for confirmation; the caller invokes `dismiss()` from the resolved result.
//
// The drag is a pure reducer (down/move/up → geometry); the only side effect
// is resolving the outside Promise. All imperative DOM is gone — the SVG rect
// geometry, cursor, pointer-events and hint opacity are reactive bindings.

import {
  component,
  mountSignalComponent,
  div,
  svg,
  rect as svgRect,
  text,
  onMount,
  type Renderable,
  type SignalViewBag,
} from '@llui/dom'
import type { NoteRect } from './note-types.js'

export interface DrawRectOptions {
  /** Stroke color for the in-progress rect. Default '#ff5252'. */
  strokeColor?: string
  /** Optional element to mount into. Defaults to document.body. */
  container?: HTMLElement
  /** Hint message auto-fade duration (ms). Default 2500. Set 0 to keep
   *  the hint visible until the user starts drawing. */
  hintFadeMs?: number
}

export interface DrawRectResult {
  rect: NoteRect | null
  reason: 'submit' | 'cancel'
  /** Remove the overlay from the DOM. Idempotent. */
  dismiss(): void
}

// ── TEA shapes (exported for component tests) ────────────────────────────

export type RectPhase = 'idle' | 'drawing' | 'captured'

export interface RectState {
  phase: RectPhase
  startX: number
  startY: number
  rect: NoteRect | null
  hintVisible: boolean
}

export type RectMsg =
  | { type: 'down'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up' }
  | { type: 'escape' }
  | { type: 'fadeHint' }

/** The only side effect: report the resolved selection to the outside world. */
export type RectEffect = { type: 'resolve'; rect: NoteRect | null; reason: 'submit' | 'cancel' }

export const rectInit = (): RectState => ({
  phase: 'idle',
  startX: 0,
  startY: 0,
  rect: null,
  hintVisible: true,
})

export const rectReduce = (state: RectState, msg: RectMsg): [RectState, RectEffect[]] => {
  switch (msg.type) {
    case 'down':
      return [
        {
          phase: 'drawing',
          startX: msg.x,
          startY: msg.y,
          rect: { x: msg.x, y: msg.y, w: 0, h: 0 },
          hintVisible: false,
        },
        [],
      ]
    case 'move': {
      if (state.phase !== 'drawing') return [state, []]
      const x = Math.min(state.startX, msg.x)
      const y = Math.min(state.startY, msg.y)
      const w = Math.abs(msg.x - state.startX)
      const h = Math.abs(msg.y - state.startY)
      return [{ ...state, rect: { x, y, w, h } }, []]
    }
    case 'up': {
      if (state.phase !== 'drawing') return [state, []]
      const r = state.rect
      // Tiny drags are accidental clicks — treat as cancel.
      if (!r || r.w < 4 || r.h < 4) {
        return [
          { ...state, phase: 'captured' },
          [{ type: 'resolve', rect: null, reason: 'cancel' }],
        ]
      }
      // Stay 'captured' (overlay visible, pointer-events off) so the user
      // sees the region while the modal confirms.
      return [{ ...state, phase: 'captured' }, [{ type: 'resolve', rect: r, reason: 'submit' }]]
    }
    case 'escape':
      return [state, [{ type: 'resolve', rect: null, reason: 'cancel' }]]
    case 'fadeHint':
      return [{ ...state, hintVisible: false }, []]
  }
}

const rectView = (
  { state, send }: SignalViewBag<RectState, RectMsg>,
  strokeColor: string,
  hintFadeMs: number,
): Renderable => [
  div(
    {
      'data-llui-overlay': 'rect',
      'style.position': 'fixed',
      'style.inset': '0',
      'style.zIndex': '2147483645',
      'style.background': 'rgba(0,0,0,0.04)',
      'style.cursor': state.map((s) => (s.phase === 'captured' ? 'default' : 'crosshair')),
      // After capture, let clicks pass through to the HUD modal.
      'style.pointerEvents': state.map((s) => (s.phase === 'captured' ? 'none' : 'auto')),
      onMouseDown: (e: MouseEvent) => send({ type: 'down', x: e.clientX, y: e.clientY }),
      onMouseMove: (e: MouseEvent) => send({ type: 'move', x: e.clientX, y: e.clientY }),
      onMouseUp: () => send({ type: 'up' }),
    },
    [
      svg(
        {
          width: '100%',
          height: '100%',
          'style.position': 'absolute',
          'style.inset': '0',
          'style.pointerEvents': 'none',
        },
        [
          svgRect({
            fill: 'rgba(255,82,82,0.12)',
            stroke: strokeColor,
            'stroke-width': '2',
            x: state.map((s) => String(s.rect?.x ?? 0)),
            y: state.map((s) => String(s.rect?.y ?? 0)),
            width: state.map((s) => String(s.rect?.w ?? 0)),
            height: state.map((s) => String(s.rect?.h ?? 0)),
          }),
        ],
      ),
      // Hint pill — first <div> child (the overlay test reads it by tag).
      div(
        {
          'style.position': 'absolute',
          'style.top': '12px',
          'style.left': '50%',
          'style.transform': 'translateX(-50%)',
          'style.background': 'rgba(0,0,0,0.78)',
          'style.color': 'white',
          'style.padding': '6px 12px',
          'style.borderRadius': '999px',
          'style.font': '13px -apple-system, BlinkMacSystemFont, sans-serif',
          'style.pointerEvents': 'none',
          'style.transition': 'opacity 400ms ease',
          'style.opacity': state.map((s) => (s.hintVisible ? '1' : '0')),
        },
        [text('Click and drag to mark a region — Esc to cancel')],
      ),
      // Global Escape + hint auto-fade timer, torn down on dispose.
      onMount(() => {
        const onKey = (e: KeyboardEvent): void => {
          if (e.key === 'Escape') {
            e.preventDefault()
            send({ type: 'escape' })
          }
        }
        document.addEventListener('keydown', onKey)
        const timer =
          hintFadeMs > 0 ? setTimeout(() => send({ type: 'fadeHint' }), hintFadeMs) : null
        return () => {
          document.removeEventListener('keydown', onKey)
          if (timer) clearTimeout(timer)
        }
      }),
    ],
  ),
]

/**
 * Activate the drawing overlay. Returns a promise that resolves when the
 * user releases the mouse (with the rect + dismiss callback) or hits Escape
 * (with null + an already-dismissed overlay).
 */
export function drawRect(opts: DrawRectOptions = {}): Promise<DrawRectResult> {
  const strokeColor = opts.strokeColor ?? '#ff5252'
  const container = opts.container ?? document.body
  const hintFadeMs = opts.hintFadeMs ?? 2500

  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute('data-llui-overlay-host', 'rect')
    container.appendChild(host)

    let disposed = false
    const dismiss = (): void => {
      if (disposed) return
      disposed = true
      handle.dispose() // tears down bindings + onMount cleanups (keydown/timer)
      host.remove()
    }

    let settled = false
    const settle = (r: NoteRect | null, reason: 'submit' | 'cancel'): void => {
      if (settled) return
      settled = true
      if (reason === 'cancel') dismiss()
      resolve({ rect: r, reason, dismiss })
    }

    // init has no effects, so onEffect cannot fire before `handle` is bound.
    const handle = mountSignalComponent<RectState, RectMsg, RectEffect>(
      host,
      component<RectState, RectMsg, RectEffect>({
        name: 'llui-devmode-annotate:rect',
        init: rectInit,
        update: rectReduce,
        view: (bag) => rectView(bag, strokeColor, hintFadeMs),
        onEffect: (eff) => {
          if (eff.type === 'resolve') settle(eff.rect, eff.reason)
        },
      }),
      { devtools: false },
    )
  })
}
