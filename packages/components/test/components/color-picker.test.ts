import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  toHex,
  toHex8,
  hexToHsl,
  hslToRgb,
  hslToHsv,
  hsvToHsl,
  colorFromPoint,
  stateHsl,
} from '../../src/components/color-picker'
import { rootSignal, read } from '../_signal'

describe('color-picker reducer', () => {
  it('initializes red', () => {
    expect(stateHsl(init())).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('setHue wraps mod 360', () => {
    expect(update(init(), { type: 'setHue', h: 400 })[0].hsv.h).toBe(40)
    expect(update(init(), { type: 'setHue', h: -10 })[0].hsv.h).toBe(350)
  })

  it('setSaturation clamps 0..100', () => {
    expect(stateHsl(update(init(), { type: 'setSaturation', s: 150 })[0]).s).toBe(100)
    expect(stateHsl(update(init(), { type: 'setSaturation', s: -50 })[0]).s).toBe(0)
  })

  it('setHex accepts valid hex', () => {
    const [s] = update(init(), { type: 'setHex', hex: '#00ff00' })
    const hsl = stateHsl(s)
    expect(hsl.h).toBe(120)
    expect(hsl.s).toBe(100)
    expect(hsl.l).toBe(50)
  })

  it('setHex rejects invalid hex', () => {
    const [s] = update(init(), { type: 'setHex', hex: 'notahex' })
    expect(s).toEqual(init())
  })

  it('setAlpha clamps 0..1', () => {
    expect(update(init(), { type: 'setAlpha', alpha: 2 })[0].alpha).toBe(1)
    expect(update(init(), { type: 'setAlpha', alpha: -0.5 })[0].alpha).toBe(0)
  })
})

describe('color conversion', () => {
  it('hslToRgb for primaries', () => {
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 })
    expect(hslToRgb({ h: 120, s: 100, l: 50 })).toEqual({ r: 0, g: 255, b: 0 })
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('toHex produces valid hex', () => {
    expect(toHex({ h: 0, s: 100, l: 50 })).toBe('#ff0000')
    expect(toHex({ h: 120, s: 100, l: 50 })).toBe('#00ff00')
  })

  it('hexToHsl roundtrips via toHex', () => {
    const hsl = { h: 180, s: 50, l: 50 }
    const hex = toHex(hsl)
    const back = hexToHsl(hex)
    expect(back?.h).toBeGreaterThanOrEqual(179)
    expect(back?.h).toBeLessThanOrEqual(181)
  })

  it('hexToHsl handles 3-char form', () => {
    expect(hexToHsl('#f00')).toEqual(hexToHsl('#ff0000'))
  })

  it('hexToHsl rejects invalid', () => {
    expect(hexToHsl('xyz')).toBeNull()
    expect(hexToHsl('#gg0000')).toBeNull()
  })
})

describe('hsv conversion edge cases', () => {
  it('black: l=0 -> v=0', () => {
    const hsv = hslToHsv({ h: 0, s: 0, l: 0 })
    expect(hsv.v).toBe(0)
    expect(hsv.s).toBe(0)
  })

  it('white: l=100 -> v=100, s=0', () => {
    const hsv = hslToHsv({ h: 0, s: 0, l: 100 })
    expect(hsv.v).toBe(100)
    expect(hsv.s).toBe(0)
  })

  it('mid grey: l=50 s=0 -> v=50, s=0', () => {
    const hsv = hslToHsv({ h: 0, s: 0, l: 50 })
    expect(hsv.v).toBe(50)
    expect(hsv.s).toBe(0)
  })

  it('pure red: HSL(0,100,50) <-> HSV(0,100,100)', () => {
    expect(hslToHsv({ h: 0, s: 100, l: 50 })).toEqual({ h: 0, s: 100, v: 100 })
    expect(hsvToHsl({ h: 0, s: 100, v: 100 })).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('hslToHsv <-> hsvToHsl roundtrips greys without NaN', () => {
    for (const l of [0, 25, 50, 75, 100]) {
      const hsv = hslToHsv({ h: 0, s: 0, l })
      expect(Number.isNaN(hsv.s)).toBe(false)
      expect(Number.isNaN(hsv.v)).toBe(false)
      const back = hsvToHsl(hsv)
      expect(back.l).toBe(l)
      expect(back.s).toBe(0)
    }
  })

  it('hsvToHsl black has no NaN saturation', () => {
    const hsl = hsvToHsl({ h: 0, s: 0, v: 0 })
    expect(Number.isNaN(hsl.s)).toBe(false)
    expect(hsl).toEqual({ h: 0, s: 0, l: 0 })
  })
})

describe('colorFromPoint', () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 } as DOMRect

  it('top-left = full value, zero saturation', () => {
    expect(colorFromPoint(rect, 0, 0)).toEqual({ s: 0, v: 100 })
  })

  it('top-right = full value, full saturation', () => {
    expect(colorFromPoint(rect, 200, 0)).toEqual({ s: 100, v: 100 })
  })

  it('bottom-left = zero value, zero saturation', () => {
    expect(colorFromPoint(rect, 0, 100)).toEqual({ s: 0, v: 0 })
  })

  it('center = half saturation, half value', () => {
    expect(colorFromPoint(rect, 100, 50)).toEqual({ s: 50, v: 50 })
  })

  it('clamps out-of-bounds points', () => {
    expect(colorFromPoint(rect, -50, 200)).toEqual({ s: 0, v: 0 })
    expect(colorFromPoint(rect, 999, -10)).toEqual({ s: 100, v: 100 })
  })
})

describe('color-picker area (HSV) reducer', () => {
  it('setSv stores S/V directly in HSV state, preserving hue', () => {
    const [s] = update(init({ hsv: { h: 200, s: 100, v: 100 } }), {
      type: 'setSv',
      s: 50,
      v: 80,
    })
    expect(s.hsv).toEqual({ h: 200, s: 50, v: 80 })
  })

  it('setSv clamps to 0..100', () => {
    const [s] = update(init(), { type: 'setSv', s: 150, v: -20 })
    expect(s.hsv.s).toBe(100)
    expect(s.hsv.v).toBe(0)
  })

  it('nudgeSv moves S/V by signed deltas (HSV space)', () => {
    const start = init({ hsv: { h: 0, s: 50, v: 50 } })
    const [s] = update(start, { type: 'nudgeSv', ds: 10, dv: -10 })
    expect(s.hsv.s).toBe(60)
    expect(s.hsv.v).toBe(40)
  })

  it('nudgeSv clamps at bounds', () => {
    const start = init({ hsv: { h: 0, s: 100, v: 0 } })
    const [s] = update(start, { type: 'nudgeSv', ds: 50, dv: -50 })
    expect(s.hsv.s).toBe(100)
    expect(s.hsv.v).toBe(0)
  })

  it('nudgeSv on black still preserves hue (HSV advantage over HSL)', () => {
    const start = init({ hsv: { h: 270, s: 80, v: 0 } })
    const [s] = update(start, { type: 'nudgeSv', ds: 0, dv: 20 })
    expect(s.hsv.h).toBe(270)
    expect(s.hsv.v).toBe(20)
  })
})

describe('color-picker setColor (swatch)', () => {
  it('setColor applies a hex color', () => {
    const [s] = update(init(), { type: 'setColor', color: '#0000ff' })
    expect(stateHsl(s)).toEqual({ h: 240, s: 100, l: 50 })
  })

  it('setColor ignores invalid color', () => {
    const before = init()
    const [s] = update(before, { type: 'setColor', color: 'nope' })
    expect(s).toEqual(before)
  })

  it('setColor with 8-digit hex sets alpha too', () => {
    const [s] = update(init(), { type: 'setColor', color: '#ff000080' })
    expect(stateHsl(s).h).toBe(0)
    expect(s.alpha).toBeCloseTo(128 / 255, 4)
  })
})

describe('8-digit hex (alpha) round-trip', () => {
  it('toHex8 appends alpha byte', () => {
    expect(toHex8({ h: 0, s: 100, l: 50 }, 1)).toBe('#ff0000ff')
    expect(toHex8({ h: 0, s: 100, l: 50 }, 0)).toBe('#ff000000')
    expect(toHex8({ h: 0, s: 100, l: 50 }, 0.5)).toBe('#ff000080')
  })

  it('alpha round-trips via toHex8 -> setColor', () => {
    const hex = toHex8({ h: 120, s: 100, l: 50 }, 0.5)
    const [s] = update(init(), { type: 'setColor', color: hex })
    expect(stateHsl(s)).toEqual({ h: 120, s: 100, l: 50 })
    expect(Math.round(s.alpha * 255)).toBe(128)
  })
})

describe('color-picker.connect area + alpha + swatches', () => {
  it('area thumb has slider role and 2D valuetext', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(p.areaThumb.role).toBe('slider')
    const vt = read(p.areaThumb['aria-valuetext'], init({ hsl: { h: 0, s: 100, l: 50 } }))
    expect(vt).toContain('100')
  })

  it('area thumb arrow keys nudge S/V (Shift = coarse)', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { step: 1, coarseStep: 10 })
    const mk = (key: string, shift = false): KeyboardEvent =>
      ({
        key,
        shiftKey: shift,
        preventDefault: vi.fn(),
        currentTarget: document.createElement('div'),
      }) as unknown as KeyboardEvent
    p.areaThumb.onKeyDown(mk('ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeSv', ds: 1, dv: 0 })
    p.areaThumb.onKeyDown(mk('ArrowUp', true))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeSv', ds: 0, dv: 10 })
    p.areaThumb.onKeyDown(mk('ArrowDown'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeSv', ds: 0, dv: -1 })
    p.areaThumb.onKeyDown(mk('ArrowLeft', true))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeSv', ds: -10, dv: 0 })
  })

  it('alphaSlider tracks alpha and dispatches setAlpha', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { alphaLabel: 'Opacity' })
    expect(p.alphaSlider['aria-label']).toBe('Opacity')
    expect(p.alphaSlider.min).toBe(0)
    expect(p.alphaSlider.max).toBe(1)
    expect(read(p.alphaSlider.value, init({ alpha: 0.5 }))).toBe('0.5')
    const target = document.createElement('input')
    target.value = '0.25'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    p.alphaSlider.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setAlpha', alpha: 0.25 })
  })

  it('swatch factory dispatches setColor and reflects selection', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const sw = p.swatch('#00ff00')
    sw.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'setColor', color: '#00ff00' })
    expect(read(sw['data-state'], init({ hsl: { h: 120, s: 100, l: 50 } }))).toBe('selected')
    expect(read(sw['data-state'], init({ hsl: { h: 0, s: 100, l: 50 } }))).toBe(undefined)
  })

  it('area track exposes background hue', () => {
    const p = connect(rootSignal(), vi.fn())
    const style = read(p.area.style, init({ hsl: { h: 200, s: 100, l: 50 } }))
    expect(style).toContain('200')
  })
})

describe('color-picker.connect', () => {
  const p = connect(rootSignal(), vi.fn())

  it('hueSlider value tracks hue', () => {
    expect(read(p.hueSlider.value, init({ hsl: { h: 180, s: 50, l: 50 } }))).toBe('180')
  })

  it('hexInput value renders current color', () => {
    expect(read(p.hexInput.value, init({ hsl: { h: 0, s: 100, l: 50 } }))).toBe('#ff0000')
  })

  it('hueSlider onInput dispatches setHue', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = '60'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.hueSlider.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setHue', h: 60 })
  })

  it('preview style contains current hex', () => {
    expect(read(p.preview.style, init({ hsl: { h: 120, s: 100, l: 50 } }))).toContain('#00ff00')
  })
})
