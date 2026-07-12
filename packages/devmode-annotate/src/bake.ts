// Bake annotations onto a screenshot. Pure-ish function: takes a base64
// PNG + annotations[] in viewport pixel coordinates, returns a new
// base64 PNG with annotations drawn on top.
//
// jsdom doesn't ship a real canvas — tests stub the canvas factory
// (`createCanvas`) to inspect the draw calls without needing a raster
// pipeline.

import type { Annotation } from './note-types.js'

export interface BakeOptions {
  /** Canvas factory. Defaults to document.createElement('canvas'). Tests
   *  inject a mock to inspect draw calls without a raster backend. */
  createCanvas?: () => HTMLCanvasElement
  /** Image loader. Defaults to a real Image() with src = dataUrl. Tests
   *  can substitute to skip the image-decode pipeline. */
  loadImage?: (dataUrl: string) => Promise<{ width: number; height: number }>
  /** Stroke color for annotations. Default '#ff5252' (a high-contrast red). */
  strokeColor?: string
  /** Label text color. Default '#fff'. */
  labelColor?: string
  /** Label background color. Default the strokeColor. */
  labelBg?: string
  /**
   * Device-pixel-ratio the screenshot was captured at. Used only as the
   * FALLBACK scale when the live document width can't be read (e.g. jsdom,
   * where `documentElement.clientWidth` is 0). Threaded from the note
   * frontmatter's `viewport.dpr`. Default 1.
   */
  dpr?: number
  /**
   * Canvas-pixels-per-CSS-pixel. Annotations arrive in viewport (CSS) pixels
   * but the screenshot is a DPR-scaled raster of the whole document, so every
   * coordinate must be multiplied by this before it's stroked. Defaults to
   * `canvas.width / documentElement.clientWidth` (the true capture scale),
   * falling back to `dpr`, then 1.
   */
  scale?: number
  /**
   * Viewport scroll offset (CSS px) at capture time. Annotation coords are
   * viewport-relative (`getBoundingClientRect`) but the screenshot spans the
   * whole document, so the scroll offset is added before scaling. Defaults to
   * `window.scrollX` / `window.scrollY`, then 0.
   */
  scrollX?: number
  scrollY?: number
}

/** Viewport→canvas coordinate mapping resolved from BakeOptions + environment. */
interface CoordTransform {
  scale: number
  scrollX: number
  scrollY: number
}

function resolveTransform(opts: BakeOptions, canvasWidth: number): CoordTransform {
  const clientWidth =
    typeof document !== 'undefined' && document.documentElement
      ? document.documentElement.clientWidth
      : 0
  const scale =
    opts.scale ?? (clientWidth > 0 && canvasWidth > 0 ? canvasWidth / clientWidth : (opts.dpr ?? 1))
  const scrollX = opts.scrollX ?? (typeof window !== 'undefined' ? window.scrollX || 0 : 0)
  const scrollY = opts.scrollY ?? (typeof window !== 'undefined' ? window.scrollY || 0 : 0)
  return { scale: scale || 1, scrollX, scrollY }
}

const DEFAULT_STROKE = '#ff5252'
const DEFAULT_LABEL_COLOR = '#ffffff'
const STROKE_WIDTH = 3
const LABEL_FONT_PX = 13
const LABEL_FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const LABEL_FONT = `${LABEL_FONT_PX}px ${LABEL_FONT_FAMILY}`
const LABEL_PAD_X = 6
const LABEL_PAD_Y = 3

/** Returns the dataURL of the baked PNG. */
export async function bakeAnnotations(
  screenshotBase64: string,
  annotations: Annotation[],
  opts: BakeOptions = {},
): Promise<string> {
  const strokeColor = opts.strokeColor ?? DEFAULT_STROKE
  const labelColor = opts.labelColor ?? DEFAULT_LABEL_COLOR
  const labelBg = opts.labelBg ?? strokeColor

  const dataUrl = screenshotBase64.startsWith('data:')
    ? screenshotBase64
    : `data:image/png;base64,${screenshotBase64}`

  const img = await (opts.loadImage ?? defaultLoadImage)(dataUrl)
  const canvas = (opts.createCanvas ?? defaultCreateCanvas)()
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('bakeAnnotations: 2D canvas context unavailable')
  }

  // Draw the base image. The loadImage hook returned dimensions; we
  // still need the pixels — for the default path this is a real
  // HTMLImageElement we can pass to drawImage. The injected variant in
  // tests doesn't reach this path because the mock canvas ignores draws.
  if (img instanceof HTMLImageElement) {
    ctx.drawImage(img, 0, 0)
  }

  // Map viewport (CSS px, scroll-relative) annotation coords → canvas
  // (document-space, DPR-scaled) pixels.
  const transform = resolveTransform(opts, img.width)

  ctx.lineWidth = STROKE_WIDTH * transform.scale
  ctx.strokeStyle = strokeColor
  ctx.fillStyle = labelBg
  ctx.font = LABEL_FONT

  for (const ann of annotations) {
    drawAnnotation(ctx, ann, { strokeColor, labelColor, labelBg }, transform)
  }

  return canvas.toDataURL('image/png')
}

interface DrawColors {
  strokeColor: string
  labelColor: string
  labelBg: string
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  colors: DrawColors,
  t: CoordTransform,
): void {
  ctx.strokeStyle = colors.strokeColor
  ctx.lineWidth = STROKE_WIDTH * t.scale

  const map = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
    (x + t.scrollX) * t.scale,
    (y + t.scrollY) * t.scale,
    w * t.scale,
    h * t.scale,
  ]

  switch (ann.type) {
    case 'rect': {
      const [x, y, w, h] = map(ann.x, ann.y, ann.w, ann.h)
      ctx.strokeRect(x, y, w, h)
      if (ann.label) drawLabel(ctx, ann.label, x, y, colors, t)
      break
    }
    case 'element': {
      const [x, y, w, h] = map(ann.bbox.x, ann.bbox.y, ann.bbox.w, ann.bbox.h)
      ctx.strokeRect(x, y, w, h)
      if (ann.label) drawLabel(ctx, ann.label, x, y, colors, t)
      break
    }
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colors: DrawColors,
  t: CoordTransform,
): void {
  // `x`/`y` are already canvas-space (mapped by the caller). Scale the label
  // box + text so it stays legible on a DPR-scaled raster.
  ctx.font = t.scale === 1 ? LABEL_FONT : `${LABEL_FONT_PX * t.scale}px ${LABEL_FONT_FAMILY}`
  const w = ctx.measureText(text).width
  const h = 16 * t.scale
  const padX = LABEL_PAD_X * t.scale
  const padY = LABEL_PAD_Y * t.scale
  // Place the label above-and-left of the anchor point; clamp to canvas
  // edges to avoid clipping.
  const labelX = Math.max(0, x)
  const labelY = Math.max(h + padY * 2, y) - h - padY
  ctx.fillStyle = colors.labelBg
  ctx.fillRect(labelX, labelY, w + padX * 2, h + padY * 2)
  ctx.fillStyle = colors.labelColor
  ctx.fillText(text, labelX + padX, labelY + h)
}

function defaultCreateCanvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

function defaultLoadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('bakeAnnotations: failed to load screenshot'))
    img.src = dataUrl
  })
}
