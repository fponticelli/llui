import {
  component,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  p,
  canvas,
  img,
  onMount,
} from '@llui/dom'
import {
  signaturePad,
  type SignaturePadState,
  type SignaturePadMsg,
} from '@llui/components/signature-pad'
import {
  imageCropper,
  type ImageCropperState,
  type ImageCropperMsg,
} from '@llui/components/image-cropper'
import { sectionGroup, card } from '../shared/ui'

type State = {
  sig: SignaturePadState
  crop: ImageCropperState
}
type Msg =
  | { type: 'sig'; msg: SignaturePadMsg }
  | { type: 'crop'; msg: ImageCropperMsg }

const init = (): [State, never[]] => [
  {
    sig: signaturePad.init(),
    // Image dimensions filled in by img onLoad; crop is computed lazily.
    crop: imageCropper.init({ aspectRatio: 1 }),
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.sig,
    set: (s, v) => ({ ...s, sig: v }),
    narrow: (m) => (m.type === 'sig' ? m.msg : null),
    sub: signaturePad.update,
  }),
  sliceHandler({
    get: (s) => s.crop,
    set: (s, v) => ({ ...s, crop: v }),
    narrow: (m) => (m.type === 'crop' ? m.msg : null),
    sub: imageCropper.update,
  }),
)

// Inline SVG placeholder used by the image-cropper demo — avoids loading
// from an external host. 400×300 gradient with a grid.
const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#7c3aed"/>' +
      '<stop offset="100%" stop-color="#ec4899"/>' +
      '</linearGradient></defs>' +
      '<rect width="400" height="300" fill="url(#g)"/>' +
      '<g stroke="rgba(255,255,255,.3)" stroke-width="1">' +
      Array.from({ length: 9 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="300"/>`).join('') +
      Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="400" y2="${i * 50}"/>`).join('') +
      '</g>' +
      '<text x="200" y="160" text-anchor="middle" fill="white" font-family="sans-serif" ' +
      'font-size="24" font-weight="bold">Sample Image</text>' +
      '</svg>',
  )

export const App = component<State, Msg, never>({
  name: 'CanvasSection',
  init,
  update,
  view: (send) => {
    const sp = signaturePad.connect<State>(
      (s) => s.sig,
      (m) => send({ type: 'sig', msg: m }),
    )
    const ic = imageCropper.connect<State>(
      (s) => s.crop,
      (m) => send({ type: 'crop', msg: m }),
    )

    // Pointer events for the signature canvas — dispatches stroke
    // messages. The stroke visualization uses a reactive SVG overlay
    // (see below) so we don't need an imperative paint loop.
    onMount(() => {
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
    onMount(() => {
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
      sectionGroup('Canvas + image', [
        card('Signature Pad', [
          div({ ...sp.root, class: 'flex flex-col gap-2' }, [
            p({ class: 'text-xs text-slate-500' }, [
              text('Draw with mouse or touch. Strokes accumulate in state.'),
            ]),
            div(
              {
                ...sp.control,
                class: 'relative border border-slate-300 rounded bg-white',
              },
              [
                canvas({
                  width: 400,
                  height: 150,
                  'data-scope': 'signature-pad',
                  'data-part': 'canvas',
                  class: 'touch-none cursor-crosshair block',
                }),
                // Draw strokes reactively via an SVG overlay — simpler
                // than canvas imperative drawing and stays in sync with
                // state automatically.
                div(
                  {
                    class: 'absolute inset-0 pointer-events-none',
                    innerHTML: (s: State) => {
                      const all = s.sig.current
                        ? [...s.sig.strokes, s.sig.current]
                        : s.sig.strokes
                      const paths = all
                        .filter((stroke) => stroke.length > 0)
                        .map(
                          (stroke) =>
                            'M' +
                            stroke.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L'),
                        )
                        .join(' ')
                      return (
                        '<svg width="400" height="150" xmlns="http://www.w3.org/2000/svg">' +
                        `<path d="${paths}" stroke="#0f172a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
                        '</svg>'
                      )
                    },
                  },
                  [],
                ),
              ],
            ),
            div({ class: 'flex items-center gap-2' }, [
              button(
                { ...sp.undoTrigger, class: 'btn btn-secondary text-xs' },
                [text('Undo')],
              ),
              button(
                { ...sp.clearTrigger, class: 'btn btn-secondary text-xs' },
                [text('Clear')],
              ),
              span({ class: 'text-xs text-slate-500 ml-auto' }, [
                text((s: State) => `${s.sig.strokes.length} strokes · ${signaturePad.pointCount(s.sig)} points`),
              ]),
            ]),
          ]),
        ]),
        card('Image Cropper', [
          div({ ...ic.root, class: 'flex flex-col gap-2' }, [
            p({ class: 'text-xs text-slate-500' }, [
              text('Drag the crop box to pan; drag the corner handle to resize (1:1 aspect).'),
            ]),
            div({ class: 'relative inline-block border border-slate-300 rounded overflow-hidden' }, [
              img({
                ...ic.image,
                src: PLACEHOLDER_IMG,
                class: 'block w-[400px] h-[300px] select-none',
              }),
              // Crop box overlay — positioned via percentage from the
              // component's style binding. Darkens outside area via
              // box-shadow.
              div(
                {
                  ...ic.cropBox,
                  class: 'absolute cursor-move border-2 border-white',
                  style: (s: State) => {
                    const st = s.crop
                    if (st.image.width === 0 || st.image.height === 0) return 'display:none;'
                    const xp = (st.crop.x / st.image.width) * 100
                    const yp = (st.crop.y / st.image.height) * 100
                    const wp = (st.crop.width / st.image.width) * 100
                    const hp = (st.crop.height / st.image.height) * 100
                    return (
                      `left:${xp}%;top:${yp}%;width:${wp}%;height:${hp}%;` +
                      `box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);touch-action:none;`
                    )
                  },
                },
                [
                  div(
                    {
                      ...ic.resizeHandle('se'),
                      class:
                        'absolute -bottom-1 -right-1 w-3 h-3 bg-white border border-slate-400 cursor-se-resize rounded-sm',
                    },
                    [],
                  ),
                ],
              ),
            ]),
            div({ class: 'flex items-center gap-2 text-xs' }, [
              button(
                { ...ic.resetTrigger, class: 'btn btn-secondary' },
                [text('Reset crop')],
              ),
              span({ class: 'text-slate-500' }, [
                text(
                  (s: State) =>
                    `crop: ${Math.round(s.crop.crop.x)},${Math.round(s.crop.crop.y)} ` +
                    `${Math.round(s.crop.crop.width)}×${Math.round(s.crop.crop.height)} ` +
                    `(image: ${s.crop.image.width}×${s.crop.image.height})`,
                ),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]
  },
})
