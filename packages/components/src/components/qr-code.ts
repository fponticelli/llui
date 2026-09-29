import type { Send, ReadSignal } from '@llui/dom'
import { qrCodeLocale } from '../locale/qr-code.js'

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
  /** @intent("Set the encoded value (consumer encodes externally and dispatches setMatrix)") */
  | { type: 'setValue'; value: string }
  /** @humanOnly */
  | { type: 'setMatrix'; matrix: boolean[][] }
  /** @intent("Change the QR error-correction level (L/M/Q/H)") */
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

export interface QrCodeParts {
  /**
   * A labelled `group` around the code and its download action. `aria-label` on
   * a bare `<div>` (role `generic`) is prohibited ARIA and ignored by most
   * assistive technology, which is why the role is stated.
   */
  root: {
    role: 'group'
    'data-scope': 'qr-code'
    'data-part': 'root'
    'aria-label': string
    /** Present while no matrix has been supplied — the empty state hook. */
    'data-empty': ReadSignal<'' | undefined>
  }
  /**
   * The `role="img"` graphic carries its OWN accessible name. A screen-reader
   * user cannot scan the modules, so the name includes the encoded value.
   */
  svg: {
    'data-scope': 'qr-code'
    'data-part': 'svg'
    role: 'img'
    'aria-label': ReadSignal<string>
    viewBox: ReadSignal<string>
    'shape-rendering': 'crispEdges'
  }
  /** Spread onto a `<rect>`: sized to the module grid so it covers the quiet background. */
  background: {
    'data-scope': 'qr-code'
    'data-part': 'background'
    width: ReadSignal<string>
    height: ReadSignal<string>
  }
  /** Spread onto a `<path>`: one sub-path per dark module. */
  foreground: {
    'data-scope': 'qr-code'
    'data-part': 'foreground'
    d: ReadSignal<string>
  }
  downloadTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'qr-code'
    'data-part': 'download-trigger'
    /** Nothing to download until a matrix exists. */
    disabled: ReadSignal<boolean>
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  label?: string
  downloadLabel?: string
  /** Filename for the downloaded SVG. */
  downloadFilename?: string
}

export function connect(
  state: ReadSignal<QrCodeState>,
  send: Send<QrCodeMsg>,
  opts: ConnectOptions = {},
): QrCodeParts {
  const locale = qrCodeLocale()
  const label = opts.label ?? locale.label
  const filename = opts.downloadFilename ?? 'qrcode.svg'

  // The grid side in user units; an empty matrix keeps a 1x1 box so the svg and
  // its background stay valid, sized, and paintable in the empty state.
  const side = (st: QrCodeState): number => Math.max(size(st), 1)

  return {
    root: {
      role: 'group',
      'data-scope': 'qr-code',
      'data-part': 'root',
      'aria-label': label,
      'data-empty': state.map((st) => (size(st) === 0 ? '' : undefined)),
    },
    svg: {
      'data-scope': 'qr-code',
      'data-part': 'svg',
      role: 'img',
      'aria-label': state.map((st) => (st.value === '' ? label : `${label}: ${st.value}`)),
      viewBox: state.map((st) => `0 0 ${side(st)} ${side(st)}`),
      'shape-rendering': 'crispEdges',
    },
    background: {
      'data-scope': 'qr-code',
      'data-part': 'background',
      width: state.map((st) => String(side(st))),
      height: state.map((st) => String(side(st))),
    },
    foreground: {
      'data-scope': 'qr-code',
      'data-part': 'foreground',
      d: state.map((st) => toSvgPath(st.matrix)),
    },
    downloadTrigger: {
      type: 'button',
      'aria-label': opts.downloadLabel ?? locale.download,
      'data-scope': 'qr-code',
      'data-part': 'download-trigger',
      disabled: state.map((st) => size(st) === 0),
      onClick: (e) => {
        // Serialize THIS instance's graphic: resolve the svg from the trigger's
        // own root. A document-wide query downloaded whichever QR code came
        // first on the page (#266).
        const trigger = e.currentTarget
        if (!(trigger instanceof Element)) return
        const root = trigger.closest('[data-scope="qr-code"][data-part="root"]')
        const svg = root?.querySelector('[data-scope="qr-code"][data-part="svg"]')
        if (!svg) return
        const xml = new XMLSerializer().serializeToString(svg)
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
