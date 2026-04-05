import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, size, toSvgPath, toDataUrl } from '../../src/components/qr-code'
import type { QrCodeState } from '../../src/components/qr-code'

type Ctx = { q: QrCodeState }
const wrap = (q: QrCodeState): Ctx => ({ q })

// Helper: a simple 3x3 checkerboard matrix
const checker: boolean[][] = [
  [true, false, true],
  [false, true, false],
  [true, false, true],
]

describe('qr-code reducer', () => {
  it('starts empty', () => {
    expect(init()).toMatchObject({ value: '', matrix: [], errorCorrection: 'M' })
  })

  it('setValue updates value only', () => {
    const [s] = update(init(), { type: 'setValue', value: 'https://example.com' })
    expect(s.value).toBe('https://example.com')
    expect(s.matrix).toEqual([])
  })

  it('setMatrix stores matrix', () => {
    const [s] = update(init(), { type: 'setMatrix', matrix: checker })
    expect(s.matrix).toBe(checker)
  })

  it('setErrorCorrection changes level', () => {
    const [s] = update(init(), { type: 'setErrorCorrection', level: 'H' })
    expect(s.errorCorrection).toBe('H')
  })
})

describe('size helper', () => {
  it('returns matrix dim', () => {
    expect(size(init())).toBe(0)
    expect(size(init({ matrix: checker }))).toBe(3)
  })
})

describe('toSvgPath', () => {
  it('emits one move+draw per dark module', () => {
    const path = toSvgPath(checker)
    // 5 dark cells in a 3x3 checkerboard pattern
    expect(path.match(/M/g)).toHaveLength(5)
    expect(path).toContain('M0,0h1v1h-1z')
    expect(path).toContain('M2,2h1v1h-1z')
  })

  it('empty matrix yields empty path', () => {
    expect(toSvgPath([])).toBe('')
  })
})

describe('toDataUrl', () => {
  it('generates a data:image/svg+xml URL', () => {
    const url = toDataUrl(checker)
    expect(url).toContain('data:image/svg+xml')
    expect(url).toContain('viewBox')
    expect(url).toContain(encodeURIComponent('width="3" height="3"'))
  })

  it('empty matrix returns empty string', () => {
    expect(toDataUrl([])).toBe('')
  })

  it('custom colors apply to fill attributes', () => {
    const url = toDataUrl(checker, '#ff0000', '#00ff00')
    expect(url).toContain(encodeURIComponent('fill="#ff0000"'))
    expect(url).toContain(encodeURIComponent('fill="#00ff00"'))
  })
})

describe('qr-code.connect', () => {
  it('svg viewBox tracks matrix size', () => {
    const p = connect<Ctx>((s) => s.q, vi.fn())
    expect(p.svg.viewBox(wrap(init({ matrix: checker })))).toBe('0 0 3 3')
    expect(p.svg.viewBox(wrap(init()))).toBe('0 0 1 1')
  })

  it('foreground d is the svg path', () => {
    const p = connect<Ctx>((s) => s.q, vi.fn())
    const d = p.foreground.d(wrap(init({ matrix: checker })))
    expect(d).toBe(toSvgPath(checker))
  })

  it('root has aria-label', () => {
    const p = connect<Ctx>((s) => s.q, vi.fn(), { label: 'Payment QR' })
    expect(p.root['aria-label']).toBe('Payment QR')
  })

  it('svg has role=img + crisp-edges rendering', () => {
    const p = connect<Ctx>((s) => s.q, vi.fn())
    expect(p.svg.role).toBe('img')
    expect(p.svg['shape-rendering']).toBe('crispEdges')
  })
})
