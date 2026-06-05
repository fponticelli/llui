// Element-pick overlay — authored with @llui/dom.
//
// Activated by the "⌖ Pick element" pill in the compose view. A document-
// level mousemove (the one imperative boundary: it must read the HOST app's
// live DOM via elementFromPoint/getBoundingClientRect) feeds the hovered
// element's bbox + selector into state; the dim scrim, outline and label are
// rendered via `portal` to document.body with reactive bindings. Click locks
// the selection; the outline lingers (dim removed) until the caller dismisses.

import {
  component,
  mountSignalComponent,
  div,
  text,
  portal,
  show,
  onMount,
  type Renderable,
  type SignalViewBag,
} from '@llui/dom'
import type { NoteRect } from './note-types.js'

export interface PickResult {
  reason: 'submit' | 'cancel'
  element?: {
    selector: string
    bbox: NoteRect
  }
  /** Dismiss the lingering outline. Caller invokes once the user
   *  Send / Cancels / re-picks. Idempotent. */
  dismiss?: () => void
}

const PICKER_OVERLAY_ATTR = 'data-llui-element-picker'
const HUD_ROOT = '#llui-devmode-annotate-root'

/**
 * Build a short, stable CSS selector for the given element. Prefers `#id`,
 * then `tag.class` (first non-Llui class), then `tag:nth-of-type`. Walks up
 * at most 4 ancestors to give the LLM enough context to locate the element.
 */
export function buildSelector(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`)
      break // id is unique; nothing above matters
    }
    const tag = cur.tagName.toLowerCase()
    const classes = Array.from(cur.classList).filter((c) => !c.startsWith('llui-'))
    if (classes.length > 0) {
      parts.unshift(`${tag}.${classes[0]}`)
    } else if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(
        (c) => c.tagName === cur!.tagName,
      )
      const idx = siblings.indexOf(cur) + 1
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
    } else {
      parts.unshift(tag)
    }
  }
  return parts.join(' > ')
}

// ── TEA shapes (exported for component tests) ────────────────────────────

export type PickPhase = 'picking' | 'picked'

export interface PickState {
  phase: PickPhase
  outline: NoteRect | null
  selector: string | null
  labelText: string
  labelTop: number
  labelLeft: number
}

export type PickMsg =
  | {
      type: 'hover'
      bbox: NoteRect
      selector: string
      label: string
      labelTop: number
      labelLeft: number
    }
  | { type: 'pick' }
  | { type: 'cancel' }

export type PickEffect = {
  type: 'resolve'
  reason: 'submit' | 'cancel'
  selector?: string
  bbox?: NoteRect
}

export const pickInit = (): PickState => ({
  phase: 'picking',
  outline: null,
  selector: null,
  labelText: '',
  labelTop: 0,
  labelLeft: 0,
})

export const pickReduce = (state: PickState, msg: PickMsg): [PickState, PickEffect[]] => {
  switch (msg.type) {
    case 'hover':
      if (state.phase !== 'picking') return [state, []]
      return [
        {
          ...state,
          outline: msg.bbox,
          selector: msg.selector,
          labelText: msg.label,
          labelTop: msg.labelTop,
          labelLeft: msg.labelLeft,
        },
        [],
      ]
    case 'pick':
      if (state.phase !== 'picking' || !state.outline || !state.selector) {
        return [state, [{ type: 'resolve', reason: 'cancel' }]]
      }
      return [
        { ...state, phase: 'picked' },
        [{ type: 'resolve', reason: 'submit', selector: state.selector, bbox: state.outline }],
      ]
    case 'cancel':
      return [state, [{ type: 'resolve', reason: 'cancel' }]]
  }
}

const DIM_STYLE = {
  'style.position': 'fixed',
  'style.inset': '0',
  'style.pointerEvents': 'none',
  'style.background': 'rgba(0, 0, 0, 0.20)',
  'style.zIndex': '2147483645',
} as const

const pickView = ({ state, send }: SignalViewBag<PickState, PickMsg>): Renderable => [
  portal(() => [
    // Dim scrim — only during active picking.
    show(
      state.map((s) => (s.phase === 'picking' ? true : null)),
      () => [div({ [PICKER_OVERLAY_ATTR]: 'dim', ...DIM_STYLE }, [])],
    ),
    // Outline — present whenever an element is hovered/picked (lingers).
    show(
      state.map((s) => s.outline),
      (o) => [
        div(
          {
            [PICKER_OVERLAY_ATTR]: 'outline',
            'style.position': 'fixed',
            'style.pointerEvents': 'none',
            'style.border': '2px solid #6366f1',
            'style.background': 'rgba(99, 102, 241, 0.10)',
            'style.borderRadius': '3px',
            'style.zIndex': '2147483645',
            'style.transition':
              'top 30ms linear, left 30ms linear, width 30ms linear, height 30ms linear',
            'style.top': o.map((r) => `${r.y}px`),
            'style.left': o.map((r) => `${r.x}px`),
            'style.width': o.map((r) => `${r.w}px`),
            'style.height': o.map((r) => `${r.h}px`),
          },
          [],
        ),
      ],
    ),
    // Label — selector + size readout, follows the outline.
    show(
      state.map((s) => (s.outline ? s.labelText : null)),
      () => [
        div(
          {
            [PICKER_OVERLAY_ATTR]: 'label',
            'style.position': 'fixed',
            'style.pointerEvents': 'none',
            'style.background': '#6366f1',
            'style.color': 'white',
            'style.padding': '2px 6px',
            'style.borderRadius': '3px',
            'style.font': '11px/1.4 ui-monospace, SFMono-Regular, monospace',
            'style.zIndex': '2147483645',
            'style.maxWidth': '320px',
            'style.overflow': 'hidden',
            'style.textOverflow': 'ellipsis',
            'style.whiteSpace': 'nowrap',
            'style.top': state.map((s) => `${s.labelTop}px`),
            'style.left': state.map((s) => `${s.labelLeft}px`),
          },
          [text(state.map((s) => s.labelText))],
        ),
      ],
    ),
  ]),
  // Document-level listeners reading the host app's live DOM (the one
  // imperative boundary). Torn down on dispose via the returned cleanup.
  onMount(() => {
    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el.closest(HUD_ROOT)) return
      const r = el.getBoundingClientRect()
      const bbox: NoteRect = {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
      const selector = buildSelector(el)
      send({
        type: 'hover',
        bbox,
        selector,
        label: `${selector}  ${bbox.w}×${bbox.h}`,
        labelTop: Math.max(2, bbox.y - 22),
        labelLeft: bbox.x,
      })
    }
    const onClick = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest(HUD_ROOT)) return
      e.preventDefault()
      e.stopPropagation()
      send({ type: 'pick' })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        send({ type: 'cancel' })
      }
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }),
]

/**
 * Show the element-picker overlay. Resolves when the user clicks (submit) or
 * presses Escape (cancel). The outline lingers after submit until `dismiss()`.
 */
export async function pickElement(): Promise<PickResult> {
  if (typeof document === 'undefined') return { reason: 'cancel' }

  const host = document.createElement('div')
  host.setAttribute('data-llui-element-picker-host', '')
  document.body.appendChild(host)

  let disposed = false
  let handle: ReturnType<typeof mountSignalComponent<PickState, PickMsg, PickEffect>> | null = null
  const dismiss = (): void => {
    if (disposed) return
    disposed = true
    handle?.dispose()
    host.remove()
  }

  return new Promise<PickResult>((resolve) => {
    let settled = false
    const settle = (r: PickResult): void => {
      if (settled) return
      settled = true
      if (r.reason === 'cancel') dismiss()
      resolve(r)
    }

    handle = mountSignalComponent<PickState, PickMsg, PickEffect>(
      host,
      component<PickState, PickMsg, PickEffect>({
        name: 'llui-devmode-annotate:picker',
        init: pickInit,
        update: pickReduce,
        view: pickView,
        onEffect: (eff) => {
          if (eff.type !== 'resolve') return
          if (eff.reason === 'submit' && eff.selector && eff.bbox) {
            settle({
              reason: 'submit',
              element: { selector: eff.selector, bbox: eff.bbox },
              dismiss,
            })
          } else {
            settle({ reason: 'cancel' })
          }
        },
      }),
      { devtools: false },
    )
  })
}
