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
}

const DEFAULT_STROKE = '#ff5252'
const DEFAULT_LABEL_COLOR = '#ffffff'
const STROKE_WIDTH = 3
const LABEL_FONT = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
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

  ctx.lineWidth = STROKE_WIDTH
  ctx.strokeStyle = strokeColor
  ctx.fillStyle = labelBg
  ctx.font = LABEL_FONT

  for (const ann of annotations) {
    drawAnnotation(ctx, ann, { strokeColor, labelColor, labelBg })
  }

  return canvas.toDataURL('image/png')
}

interface DrawColors {
  strokeColor: string
  labelColor: string
  labelBg: string
}

function drawAnnotation(ctx: CanvasRenderingContext2D, ann: Annotation, colors: DrawColors): void {
  ctx.strokeStyle = colors.strokeColor
  ctx.lineWidth = STROKE_WIDTH

  switch (ann.type) {
    case 'rect':
      ctx.strokeRect(ann.x, ann.y, ann.w, ann.h)
      if (ann.label) drawLabel(ctx, ann.label, ann.x, ann.y, colors)
      break
    case 'lasso': {
      if (ann.points.length < 2) break
      ctx.beginPath()
      const first = ann.points[0]!
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < ann.points.length; i++) {
        const p = ann.points[i]!
        ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      ctx.stroke()
      if (ann.label) drawLabel(ctx, ann.label, first.x, first.y, colors)
      break
    }
    case 'pin': {
      const r = 14
      ctx.beginPath()
      ctx.arc(ann.at.x, ann.at.y, r, 0, Math.PI * 2)
      ctx.fillStyle = colors.strokeColor
      ctx.fill()
      ctx.fillStyle = colors.labelColor
      ctx.font = `bold ${LABEL_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(ann.index), ann.at.x, ann.at.y)
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
      break
    }
    case 'arrow':
      drawArrow(ctx, ann.from.x, ann.from.y, ann.to.x, ann.to.y)
      if (ann.label) drawLabel(ctx, ann.label, ann.from.x, ann.from.y, colors)
      break
    case 'element':
      ctx.strokeRect(ann.bbox.x, ann.bbox.y, ann.bbox.w, ann.bbox.h)
      if (ann.label) drawLabel(ctx, ann.label, ann.bbox.x, ann.bbox.y, colors)
      break
    case 'highlight':
      // Semantic — should have been resolved before baking. Skip silently.
      break
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colors: DrawColors,
): void {
  ctx.font = LABEL_FONT
  const w = ctx.measureText(text).width
  const h = 16
  // Place the label above-and-left of the anchor point; clamp to canvas
  // edges to avoid clipping.
  const labelX = Math.max(0, x)
  const labelY = Math.max(h + LABEL_PAD_Y * 2, y) - h - LABEL_PAD_Y
  ctx.fillStyle = colors.labelBg
  ctx.fillRect(labelX, labelY, w + LABEL_PAD_X * 2, h + LABEL_PAD_Y * 2)
  ctx.fillStyle = colors.labelColor
  ctx.fillText(text, labelX + LABEL_PAD_X, labelY + h)
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const headLen = 12
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  )
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  )
  ctx.closePath()
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()
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
