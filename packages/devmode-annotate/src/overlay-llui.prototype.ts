// PROTOTYPE — dogfooding experiment, not wired into the build.
//
// A faithful re-implementation of `drawRect` from ./overlay.ts, but the
// overlay's UI is authored with @llui/dom (TEA component on an independent
// mount root) instead of raw `document.createElement`. Same public
// signature (DrawRectOptions / DrawRectResult), so it is a drop-in swap.
//
// Purpose: measure whether dogfooding LLui for the HUD pays off, using the
// hardest piece — a drag interaction with per-frame geometry updates and
// global keyboard handling.
//
// Requires `@llui/dom` as a dependency of this package (it currently has
// none). Left out of package.json on purpose: this file is exploratory.

import {
  component,
  mountSignalComponent,
  div,
  svg,
  rect,
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
  dismiss(): void
}

// ── TEA shapes ──────────────────────────────────────────────────────────

type Phase = 'idle' | 'drawing' | 'captured'

interface State {
  phase: Phase
  startX: number
  startY: number
  rect: NoteRect | null
  hintVisible: boolean
}

type Msg =
  | { type: 'down'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'up' }
  | { type: 'escape' }
  | { type: 'fadeHint' }

// The only side effect is telling the outside world the drag resolved.
type Effect = { type: 'resolve'; rect: NoteRect | null; reason: 'submit' | 'cancel' }

const init = (): State => ({
  phase: 'idle',
  startX: 0,
  startY: 0,
  rect: null,
  hintVisible: true,
})

const update = (state: State, msg: Msg): [State, Effect[]] => {
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

const view = (
  { state, send }: SignalViewBag<State, Msg>,
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
          rect({
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
      // Global keydown (Escape) + hint auto-fade timer, both torn down on
      // dispose via the returned cleanup. Placed in the view array so it
      // registers.
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
 * Activate the drawing overlay. Same contract as ./overlay.ts#drawRect.
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
      handle.dispose() // tear down bindings + onMount cleanups (keydown/timer)
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
    const handle = mountSignalComponent<State, Msg, Effect>(
      host,
      component<State, Msg, Effect>({
        name: 'llui-draw-rect',
        init,
        update,
        view: (bag) => view(bag, strokeColor, hintFadeMs),
        onEffect: (eff) => {
          if (eff.type === 'resolve') settle(eff.rect, eff.reason)
        },
      }),
    )
  })
}
