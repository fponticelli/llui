import type { Send } from '@llui/dom'

/**
 * QR code — renders a QR matrix as SVG. llui does not bundle a QR
 * encoder (encoders are sizable and consumer apps typically already
 * have one); instead, the consumer provides the encoded matrix via
 * `setMatrix` (or through the optional `encode` callback on
 * ConnectOptions, invoked when the value changes).
 *
 * Minimum usage with a BYOE (bring-your-own-encoder) library — the
 * consumer dispatches `setMatrix` with the encoded bits from their
 * update handler:
 *
 *   import QRCode from 'qrcode-generator'
 *
 *   update: (state, msg) => {
 *     if (msg.type === 'updateQr') {
 *       const q = QRCode(0, state.qr.errorCorrection)
 *       q.addData(msg.value); q.make()
 *       const n = q.getModuleCount()
 *       const matrix: boolean[][] = []
 *       for (let y = 0; y < n; y++) {
 *         const row: boolean[] = []
 *         for (let x = 0; x < n; x++) row.push(q.isDark(y, x))
 *         matrix.push(row)
 *       }
 *       return [{ ...state, qr: { ...state.qr, value: msg.value, matrix } }, []]
 *     }
 *   }
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrCodeState {
  value: string
  /** NxN boolean matrix — true means dark (filled) module. */
  matrix: boolean[][]
  errorCorrection: ErrorCorrectionLevel
}

export type QrCodeMsg =
  | { type: 'setValue'; value: string }
  | { type: 'setMatrix'; matrix: boolean[][] }
  | { type: 'setErrorCorrection'; level: ErrorCorrectionLevel }

export interface QrCodeInit {
  value?: string
  matrix?: boolean[][]
  errorCorrection?: ErrorCorrectionLevel
}

export function init(opts: QrCodeInit = {}): QrCodeState {
  return {
    value: opts.value ?? '',
    matrix: opts.matrix ?? [],
    errorCorrection: opts.errorCorrection ?? 'M',
  }
}

export function update(state: QrCodeState, msg: QrCodeMsg): [QrCodeState, never[]] {
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setMatrix':
      return [{ ...state, matrix: msg.matrix }, []]
    case 'setErrorCorrection':
      return [{ ...state, errorCorrection: msg.level }, []]
  }
}

/** Matrix side length (in modules). Returns 0 for empty matrix. */
export function size(state: QrCodeState): number {
  return state.matrix.length
}

/**
 * Compute an SVG path string that fills every dark module. Each dark
 * module becomes a unit-sized square at (col, row) coordinates in module
 * space; the caller scales via `viewBox` or CSS. Using a single path
 * is vastly more performant than rendering N² individual <rect>s.
 */
export function toSvgPath(matrix: boolean[][]): string {
  const parts: string[] = []
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y]!
    for (let x = 0; x < row.length; x++) {
      if (row[x]) parts.push(`M${x},${y}h1v1h-1z`)
    }
  }
  return parts.join('')
}

/**
 * Encode the matrix as a monochrome 1-bit-per-pixel PNG-ish URL. This
 * is a helper for <img src> consumption — it generates a `data:image/svg+xml`
 * URL (SVG is simpler and scales losslessly).
 */
export function toDataUrl(
  matrix: boolean[][],
  foreground: string = '#000',
  background: string = '#fff',
): string {
  const s = matrix.length
  if (s === 0) return ''
  const path = toSvgPath(matrix)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">` +
    `<rect width="${s}" height="${s}" fill="${background}"/>` +
    `<path d="${path}" fill="${foreground}"/>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export interface QrCodeParts<S> {
  root: {
    'data-scope': 'qr-code'
    'data-part': 'root'
    'aria-label': string
  }
  svg: {
    'data-scope': 'qr-code'
    'data-part': 'svg'
    role: 'img'
    viewBox: (s: S) => string
    'shape-rendering': 'crispEdges'
  }
  background: {
    'data-scope': 'qr-code'
    'data-part': 'background'
  }
  foreground: {
    'data-scope': 'qr-code'
    'data-part': 'foreground'
    d: (s: S) => string
  }
  downloadTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'qr-code'
    'data-part': 'download-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  label?: string
  downloadLabel?: string
  /** Filename for the downloaded SVG. */
  downloadFilename?: string
}

export function connect<S>(
  get: (s: S) => QrCodeState,
  send: Send<QrCodeMsg>,
  opts: ConnectOptions = {},
): QrCodeParts<S> {
  const label = opts.label ?? 'QR code'
  const filename = opts.downloadFilename ?? 'qrcode.svg'

  return {
    root: {
      'data-scope': 'qr-code',
      'data-part': 'root',
      'aria-label': label,
    },
    svg: {
      'data-scope': 'qr-code',
      'data-part': 'svg',
      role: 'img',
      viewBox: (s) => {
        const n = size(get(s))
        return n > 0 ? `0 0 ${n} ${n}` : '0 0 1 1'
      },
      'shape-rendering': 'crispEdges',
    },
    background: {
      'data-scope': 'qr-code',
      'data-part': 'background',
    },
    foreground: {
      'data-scope': 'qr-code',
      'data-part': 'foreground',
      d: (s) => toSvgPath(get(s).matrix),
    },
    downloadTrigger: {
      type: 'button',
      'aria-label': opts.downloadLabel ?? 'Download QR code',
      'data-scope': 'qr-code',
      'data-part': 'download-trigger',
      onClick: () => {
        // Generate an SVG blob and trigger a download via a hidden link.
        // State isn't accessible here; caller should use the current value
        // in a DOM query or run this inside a closure with state access.
        // We dispatch a best-effort via the document for now.
        const root = document.querySelector<HTMLElement>(
          '[data-scope="qr-code"][data-part="svg"]',
        )
        if (!root) return
        const xml = new XMLSerializer().serializeToString(root)
        const blob = new Blob([xml], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      },
    },
  }
}

export const qrCode = { init, update, connect, size, toSvgPath, toDataUrl }
