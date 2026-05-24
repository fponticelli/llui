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

/** Default capture: drives `html-to-image` over the document root.
 *  `skipFonts: true` avoids the costly font-embed pass which adds ~1s
 *  on text-heavy pages. */
export const defaultCapture: CaptureFn = async (target) => {
  return toPng(target, { skipFonts: true, cacheBust: true })
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
