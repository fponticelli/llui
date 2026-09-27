import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, size, toSvgPath, toDataUrl } from '../../src/components/qr-code'
import { rootSignal, read } from '../_signal'

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
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.svg.viewBox, init({ matrix: checker }))).toBe('0 0 3 3')
    expect(read(p.svg.viewBox, init())).toBe('0 0 1 1')
  })

  it('foreground d is the svg path', () => {
    const p = connect(rootSignal(), vi.fn())
    const d = read(p.foreground.d, init({ matrix: checker }))
    expect(d).toBe(toSvgPath(checker))
  })

  it('root is a labelled group (aria-label on a bare generic is prohibited ARIA)', () => {
    const p = connect(rootSignal(), vi.fn(), { label: 'Payment QR' })
    expect(p.root.role).toBe('group')
    expect(p.root['aria-label']).toBe('Payment QR')
  })

  it('names the role=img svg itself, including the encoded value AT users cannot scan (#266)', () => {
    const p = connect(rootSignal(), vi.fn(), { label: 'Payment QR' })
    expect(read(p.svg['aria-label'], init({ value: 'https://llui.dev', matrix: checker }))).toBe(
      'Payment QR: https://llui.dev',
    )
    expect(read(p.svg['aria-label'], init())).toBe('Payment QR')
  })

  it('sizes the background part to the module grid so a bare rect spread covers it (#266)', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.background.width, init({ matrix: checker }))).toBe('3')
    expect(read(p.background.height, init({ matrix: checker }))).toBe('3')
    expect(read(p.background.width, init())).toBe('1')
  })

  it('marks an empty matrix on the root so the empty state can be styled (#266)', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.root['data-empty'], init())).toBe('')
    expect(read(p.root['data-empty'], init({ matrix: checker }))).toBeUndefined()
    expect(read(p.downloadTrigger.disabled, init())).toBe(true)
    expect(read(p.downloadTrigger.disabled, init({ matrix: checker }))).toBe(false)
  })

  it('svg has role=img + crisp-edges rendering', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(p.svg.role).toBe('img')
    expect(p.svg['shape-rendering']).toBe('crispEdges')
  })
})

describe('qr-code download trigger', () => {
  it('serializes ITS OWN instance, not the first QR code on the page (#266)', () => {
    const svgNs = 'http://www.w3.org/2000/svg'
    const make = (marker: string): { root: HTMLElement; trigger: HTMLButtonElement } => {
      const root = document.createElement('div')
      root.dataset.scope = 'qr-code'
      root.dataset.part = 'root'
      const svg = document.createElementNS(svgNs, 'svg')
      svg.setAttribute('data-scope', 'qr-code')
      svg.setAttribute('data-part', 'svg')
      svg.setAttribute('data-marker', marker)
      const trigger = document.createElement('button')
      root.append(svg, trigger)
      document.body.append(root)
      return { root, trigger }
    }
    const first = make('first')
    const second = make('second')
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:qr')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const xml = vi.spyOn(XMLSerializer.prototype, 'serializeToString')
    try {
      const p = connect(rootSignal(), vi.fn())
      p.downloadTrigger.onClick({ currentTarget: second.trigger } as unknown as MouseEvent)
      expect(xml).toHaveBeenCalledTimes(1)
      expect((xml.mock.calls[0]![0] as Element).getAttribute('data-marker')).toBe('second')
      expect(click).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      click.mockRestore()
      xml.mockRestore()
      first.root.remove()
      second.root.remove()
    }
  })
})
