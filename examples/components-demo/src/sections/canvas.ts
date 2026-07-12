import { div, button, span, p, img, svg, path, foreign, onMount, text } from '@llui/dom'
import type { Send, Signal, Renderable } from '@llui/dom'
import { signaturePad } from '@llui/components/signature-pad'
import { imageCropper } from '@llui/components/image-cropper'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

const children = { sig: signaturePad, crop: imageCropper } as const

export type State = ModulesState<typeof children>
export type Msg = ModulesMsg<typeof children>

export const init = (): [State, never[]] => [
  {
    sig: signaturePad.init(),
    // Image dimensions filled in by img onLoad; crop is computed lazily.
    crop: imageCropper.init({ aspectRatio: 1 }),
  },
  [],
]

export const update = mergeHandlers<State, Msg, never>(composeModules<State, Msg, never>(children))

// Inline SVG placeholder used by the image-cropper demo — avoids loading
// from an external host. 400×300 gradient with a grid.
const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#7c3aed"/>' +
      '<stop offset="100%" stop-color="#ec4899"/>' +
      '</linearGradient></defs>' +
      '<rect width="400" height="300" fill="url(#g)"/>' +
      '<g stroke="rgba(255,255,255,.3)" stroke-width="1">' +
      Array.from(
        { length: 9 },
        (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="300"/>`,
      ).join('') +
      Array.from(
        { length: 7 },
        (_, i) => `<line x1="0" y1="${i * 50}" x2="400" y2="${i * 50}"/>`,
      ).join('') +
      '</g>' +
      '<text x="200" y="160" text-anchor="middle" fill="white" font-family="sans-serif" ' +
      'font-size="24" font-weight="bold">Sample Image</text>' +
      '</svg>',
  )

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  const sp = signaturePad.connect(state.at('sig'), (m) => send({ type: 'sig', msg: m }))
  const ic = imageCropper.connect(state.at('crop'), (m) => send({ type: 'crop', msg: m }))

  // Pointer events for the signature canvas — dispatches stroke
  // messages. The stroke visualization uses a reactive SVG overlay
  // (see below) so we don't need an imperative paint loop.
  const signatureMount = onMount(() => {
    const canvasEl = document.querySelector<HTMLCanvasElement>(
      '[data-scope="signature-pad"][data-part="canvas"]',
    )
    if (!canvasEl) return
    const pd = (e: PointerEvent): void => {
      canvasEl.setPointerCapture(e.pointerId)
      const r = canvasEl.getBoundingClientRect()
      send({
        type: 'sig',
        msg: {
          type: 'strokeStart',
          x: e.clientX - r.left,
          y: e.clientY - r.top,
          pressure: e.pressure || undefined,
        },
      })
    }
    const pm = (e: PointerEvent): void => {
      if (!canvasEl.hasPointerCapture(e.pointerId)) return
      const r = canvasEl.getBoundingClientRect()
      send({
        type: 'sig',
        msg: {
          type: 'strokePoint',
          x: e.clientX - r.left,
          y: e.clientY - r.top,
          pressure: e.pressure || undefined,
        },
      })
    }
    const pu = (e: PointerEvent): void => {
      canvasEl.releasePointerCapture(e.pointerId)
      send({ type: 'sig', msg: { type: 'strokeEnd' } })
    }
    canvasEl.addEventListener('pointerdown', pd)
    canvasEl.addEventListener('pointermove', pm)
    canvasEl.addEventListener('pointerup', pu)
    canvasEl.addEventListener('pointercancel', pu)
    return () => {
      canvasEl.removeEventListener('pointerdown', pd)
      canvasEl.removeEventListener('pointermove', pm)
      canvasEl.removeEventListener('pointerup', pu)
      canvasEl.removeEventListener('pointercancel', pu)
    }
  })

  // Image-cropper drag/resize wiring — same document-level pattern
  // used by floating-panel.
  const cropperMount = onMount(() => {
    let last: { x: number; y: number } | null = null
    let mode: 'drag' | 'resize' | null = null
    let handle: string | null = null
    const down = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      const cropBox = el?.closest('[data-scope="image-cropper"][data-part="crop-box"]')
      const resizeHandle = el?.closest<HTMLElement>(
        '[data-scope="image-cropper"][data-part="resize-handle"]',
      )
      if (resizeHandle) {
        mode = 'resize'
        handle = resizeHandle.getAttribute('data-handle')
        last = { x: e.clientX, y: e.clientY }
        e.stopPropagation()
      } else if (cropBox) {
        mode = 'drag'
        last = { x: e.clientX, y: e.clientY }
      }
    }
    const move = (e: PointerEvent): void => {
      if (last === null || mode === null) return
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      if (mode === 'drag') {
        send({ type: 'crop', msg: { type: 'dragMove', dx, dy } })
      } else if (mode === 'resize' && handle) {
        send({ type: 'crop', msg: { type: 'resizeMove', dx, dy } })
      }
    }
    const up = (): void => {
      if (mode === 'drag') send({ type: 'crop', msg: { type: 'dragEnd' } })
      else if (mode === 'resize') send({ type: 'crop', msg: { type: 'resizeEnd' } })
      last = null
      mode = null
      handle = null
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
    }
  })

  return [
    // Placed so the signature-pad and image-cropper pointer-wiring onMounts
    // register (a discarded onMount() is inert).
    signatureMount,
    cropperMount,
    sectionGroup('Canvas + image', [
      card('Signature Pad', [
        div({ ...sp.root, class: 'flex flex-col gap-2' }, [
          p({ class: 'text-xs text-text-muted' }, [
            text('Draw with mouse or touch. Strokes accumulate in state.'),
          ]),
          div(
            {
              ...sp.control,
              class: 'relative border border-border rounded bg-white',
            },
            [
              // The signal authoring surface has no `canvas` element helper, so
              // build the canvas at the imperative boundary. No reactive inputs —
              // strokes are visualized by the SVG overlay below.
              foreign<HTMLCanvasElement, Record<string, never>>({
                mount: ({ el: host }) => {
                  const c = document.createElement('canvas')
                  c.width = 400
                  c.height = 150
                  c.setAttribute('data-scope', 'signature-pad')
                  c.setAttribute('data-part', 'canvas')
                  c.className = 'touch-none cursor-crosshair block'
                  host.appendChild(c)
                  return c
                },
                unmount: (c) => c.remove(),
              }),
              // Draw strokes reactively as a real SVG overlay (signal svg/path
              // helpers, not innerHTML — a string innerHTML prop would be set as an
              // inert attribute and never render). The path `d` is a reactive
              // signal: dark stroke on the white pad, so it stays visible in both
              // light and dark themes.
              svg(
                {
                  width: '400',
                  height: '150',
                  class: 'absolute inset-0 pointer-events-none',
                },
                [
                  path({
                    d: state.at('sig').map((sig) => {
                      const all = sig.current ? [...sig.strokes, sig.current] : sig.strokes
                      return all
                        .filter((stroke) => stroke.length > 0)
                        .map(
                          (stroke) =>
                            'M' +
                            stroke.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L'),
                        )
                        .join(' ')
                    }),
                    stroke: '#0f172a',
                    'stroke-width': '2',
                    fill: 'none',
                    'stroke-linecap': 'round',
                    'stroke-linejoin': 'round',
                  }),
                ],
              ),
            ],
          ),
          div({ class: 'flex items-center gap-2' }, [
            button({ ...sp.undoTrigger, class: 'btn btn-secondary text-xs' }, [text('Undo')]),
            button({ ...sp.clearTrigger, class: 'btn btn-secondary text-xs' }, [text('Clear')]),
            span({ class: 'text-xs text-text-muted ml-auto' }, [
              text(
                state
                  .at('sig')
                  .map(
                    (sig) =>
                      `${sig.strokes.length} strokes · ${signaturePad.pointCount(sig)} points`,
                  ),
              ),
            ]),
          ]),
        ]),
      ]),
      card('Image Cropper', [
        div({ ...ic.root, class: 'flex flex-col gap-2' }, [
          p({ class: 'text-xs text-text-muted' }, [
            text('Drag the crop box to pan; drag the corner handle to resize (1:1 aspect).'),
          ]),
          div({ class: 'relative inline-block border border-border rounded overflow-hidden' }, [
            img({
              ...ic.image,
              src: PLACEHOLDER_IMG,
              alt: 'Sample image for cropping',
              class: 'block w-[400px] h-[300px] select-none',
            }),
            // Crop box overlay — positioned via percentage from the
            // component's style binding. Darkens outside area via
            // box-shadow.
            div(
              {
                ...ic.cropBox,
                class: 'absolute cursor-move border-2 border-white',
                style: state.at('crop').map((st) => {
                  if (st.image.width === 0 || st.image.height === 0) return 'display:none;'
                  const xp = (st.crop.x / st.image.width) * 100
                  const yp = (st.crop.y / st.image.height) * 100
                  const wp = (st.crop.width / st.image.width) * 100
                  const hp = (st.crop.height / st.image.height) * 100
                  return (
                    `left:${xp}%;top:${yp}%;width:${wp}%;height:${hp}%;` +
                    `box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);touch-action:none;`
                  )
                }),
              },
              [
                div(
                  {
                    ...ic.resizeHandle('se'),
                    class:
                      'absolute -bottom-1 -right-1 w-3 h-3 bg-white border border-border cursor-se-resize rounded-sm',
                  },
                  [],
                ),
              ],
            ),
          ]),
          div({ class: 'flex items-center gap-2 text-xs' }, [
            button({ ...ic.resetTrigger, class: 'btn btn-secondary' }, [text('Reset crop')]),
            span({ class: 'text-text-muted' }, [
              text(
                state
                  .at('crop')
                  .map(
                    (crop) =>
                      `crop: ${Math.round(crop.crop.x)},${Math.round(crop.crop.y)} ` +
                      `${Math.round(crop.crop.width)}×${Math.round(crop.crop.height)} ` +
                      `(image: ${crop.image.width}×${crop.image.height})`,
                  ),
              ),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]
}
