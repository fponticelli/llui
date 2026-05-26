// Screenshot capture for the dev-mode HUD. Wraps `html-to-image` with
// an injectable capture function so tests (jsdom) can substitute a
// deterministic stub without needing a real canvas pipeline.
//
// The dataURL returned is `data:image/png;base64,…` — strip the prefix
// to get the base64 payload that POSTs to /_llui/notes expect.

import { toPng } from 'html-to-image'

export type CaptureFn = (target: HTMLElement) => Promise<string>

/** Strip the `data:image/png;base64,` prefix from a dataURL. Returns
 *  the raw base64 payload, which is what the notes middleware expects. */
export function dataUrlToBase64(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx === -1) return dataUrl
  return dataUrl.slice(commaIdx + 1)
}

// 1x1 fully transparent PNG. html-to-image substitutes this when any
// embedded image fails to fetch (CORS, 404, decode error). Without it,
// the entire capture rejects with a bare `Event` and the user sees
// "[object Event]". The visual cost is invisible — failed images
// render as blank rectangles instead of tanking the whole screenshot.
const TRANSPARENT_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** Default capture: drives `html-to-image` over the document root.
 *  - `skipFonts: true` avoids the costly font-embed pass (~1s on text-heavy pages).
 *  - `imagePlaceholder` keeps the capture from rejecting when CORS-blocked or
 *    broken `<img>` tags exist in the tree — failed images render blank.
 *  - `onImageErrorHandler` surfaces the offending src to the console so the
 *    developer can spot a misconfigured asset. */
export const defaultCapture: CaptureFn = async (target) => {
  return toPng(target, {
    skipFonts: true,
    cacheBust: true,
    imagePlaceholder: TRANSPARENT_PIXEL_PNG,
    onImageErrorHandler: (ev) => {
      const img = (ev as Event & { target?: { src?: string } })?.target
      const src = img?.src ?? '<unknown>'
      console.warn(`[llui:devmode-annotate] image load failed during capture: ${src}`)
    },
  })
}

/**
 * Best-effort human-readable message from any thrown value. `html-to-image`
 * historically rejects with a raw `Event` (image onerror) which stringifies
 * to "[object Event]" — extract the failing src/tagName when present so the
 * developer sees something actionable.
 */
export function describeCaptureError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const ev = err as { target?: { src?: string; tagName?: string }; type?: string }
    if (ev.target?.src) return `image load failed: ${ev.target.src}`
    if (ev.target?.tagName) return `<${ev.target.tagName.toLowerCase()}> load failed`
    if (ev.type) return `capture aborted on '${ev.type}' event`
  }
  return String(err)
}

export interface CaptureScreenshotOptions {
  /** Element to capture. Defaults to document.documentElement. */
  target?: HTMLElement
  /** Override the capture function — used by tests to inject a stub. */
  capture?: CaptureFn
}

/**
 * Capture a screenshot of the current page as a base64 PNG. Returns
 * a base64-only string (no `data:` prefix).
 */
export async function captureScreenshot(opts: CaptureScreenshotOptions = {}): Promise<string> {
  const target = opts.target ?? document.documentElement
  const capture = opts.capture ?? defaultCapture
  const dataUrl = await capture(target)
  return dataUrlToBase64(dataUrl)
}
