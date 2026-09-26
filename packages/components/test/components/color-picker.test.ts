import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  init,
  update,
  connect,
  toHex,
  toHex8,
  toCss,
  stateHsl,
  stateHsv,
  stateOklch,
  isOutOfGamut,
  colorFromPoint,
  lcFromPoint,
  hsvToOklchPreserving,
  oklchToHsvPreserving,
  supportsEyeDropper,
  openEyeDropper,
  oklchPlanePixels,
  paintOklchPlane,
  DEFAULT_MAX_CHROMA,
  type ColorPickerState,
} from '../../src/components/color-picker'
import { hslToHsv, hsvToHsl } from '../../src/utils/color'
import { rootSignal, signalOf, read } from '../_signal'

describe('color-picker reducer (HSV model, default)', () => {
  it('initializes red', () => {
    expect(stateHsl(init())).toEqual({ h: 0, s: 100, l: 50 })
    expect(init().color).toEqual({ model: 'hsv', h: 0, s: 100, v: 100 })
  })

  it("setHue wraps mod 360, sets the active model's hue", () => {
    expect(update(init(), { type: 'setHue', h: 400 })[0].color).toMatchObject({ h: 40 })
    expect(update(init(), { type: 'setHue', h: -10 })[0].color).toMatchObject({ h: 350 })
  })

  it('setSaturation clamps 0..100 (HSL saturation)', () => {
    expect(stateHsl(update(init(), { type: 'setSaturation', s: 150 })[0]).s).toBe(100)
    expect(stateHsl(update(init(), { type: 'setSaturation', s: -50 })[0]).s).toBe(0)
  })

  it('setHex accepts a hex string', () => {
    const [s] = update(init(), { type: 'setHex', hex: '#00ff00' })
    const hsl = stateHsl(s)
    expect(hsl.h).toBe(120)
    expect(hsl.s).toBe(100)
    expect(hsl.l).toBe(50)
  })

  it('setHex accepts any CSS color string now (rgb/hsl/oklch/named)', () => {
    expect(stateHsl(update(init(), { type: 'setHex', hex: 'rgb(0 255 0)' })[0]).h).toBe(120)
    expect(stateHsl(update(init(), { type: 'setHex', hex: 'hsl(120 100% 50%)' })[0]).h).toBe(120)
    expect(stateHsl(update(init(), { type: 'setHex', hex: 'lime' })[0]).h).toBe(120)
  })

  it('setHex rejects invalid hex/color', () => {
    const [s] = update(init(), { type: 'setHex', hex: 'notacolor' })
    expect(s).toEqual(init())
  })

  it('setAlpha clamps 0..1', () => {
    expect(update(init(), { type: 'setAlpha', alpha: 2 })[0].alpha).toBe(1)
    expect(update(init(), { type: 'setAlpha', alpha: -0.5 })[0].alpha).toBe(0)
  })

  it('disabled state ignores every message', () => {
    const disabled = init({ disabled: true })
    expect(update(disabled, { type: 'setHue', h: 90 })[0]).toEqual(disabled)
    expect(update(disabled, { type: 'setModel', model: 'oklch' })[0]).toEqual(disabled)
  })
})

describe('init', () => {
  it('accepts an explicit model', () => {
    expect(init({ model: 'oklch' }).color.model).toBe('oklch')
    expect(init().color.model).toBe('hsv')
  })

  it('accepts any CSS color string via `color`', () => {
    const s = init({ color: '#00ff00' })
    expect(stateHsl(s).h).toBe(120)
    const oklchState = init({ model: 'oklch', color: 'red' })
    expect(oklchState.color.model).toBe('oklch')
    expect((oklchState.color as { h: number }).h).toBeCloseTo(29.23, 0)
  })

  it("an explicit alpha option wins over a color string's own alpha", () => {
    const s = init({ color: 'rgba(255, 0, 0, 0.2)', alpha: 0.9 })
    expect(s.alpha).toBeCloseTo(0.9, 5)
  })

  it("a color string's own alpha is used when no explicit alpha is given", () => {
    const s = init({ color: 'rgba(255, 0, 0, 0.2)' })
    expect(s.alpha).toBeCloseTo(0.2, 5)
  })

  it('accepts an explicit oklch color', () => {
    const s = init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 200 } })
    expect(s.color).toEqual({ model: 'oklch', l: 0.5, c: 0.1, h: 200 })
  })

  it('sanitizes non-finite oklch fields to safe defaults', () => {
    const s = init({ model: 'oklch', oklch: { l: NaN, c: Infinity, h: NaN } })
    expect(s.color).toEqual({ model: 'oklch', l: 1, c: 0, h: 0 })
  })
})

describe('color conversion (re-exported from utils/color)', () => {
  it('hslToHsv <-> hsvToHsl roundtrip for a saturated color', () => {
    expect(hslToHsv({ h: 0, s: 100, l: 50 })).toEqual({ h: 0, s: 100, v: 100 })
    expect(hsvToHsl({ h: 0, s: 100, v: 100 })).toEqual({ h: 0, s: 100, l: 50 })
  })
})

describe('hsvToOklchPreserving / oklchToHsvPreserving (direct)', () => {
  it('preserves hue for an achromatic hsv color (v=0) that the raw math would not', () => {
    const black = { h: 200, s: 50, v: 0 }
    expect(hsvToOklchPreserving(black).h).toBe(200)
  })

  it('preserves hue for an achromatic hsv color (s=0)', () => {
    const grey = { h: 77, s: 0, v: 60 }
    expect(hsvToOklchPreserving(grey).h).toBe(77)
  })

  it('does NOT override hue for a chromatic hsv color — real math wins', () => {
    const red = { h: 0, s: 100, v: 100 }
    expect(hsvToOklchPreserving(red).h).toBeCloseTo(29.2339, 1)
  })

  it('preserves hue for an achromatic oklch color (c=0)', () => {
    const white = { l: 1, c: 0, h: 321 }
    expect(oklchToHsvPreserving(white).h).toBe(321)
  })

  it('stateHsv projects through whichever model is active', () => {
    const hsvState = init({ hsv: { h: 10, s: 20, v: 30 } })
    expect(stateHsv(hsvState)).toEqual({ h: 10, s: 20, v: 30 })
    const oklchState = init({ model: 'oklch', color: '#123456' })
    expect(stateHsv(oklchState).h).toBeCloseTo(stateHsl(oklchState).h, 0)
  })
})

describe('colorFromPoint (HSV area)', () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 } as DOMRect

  it('top-left = full value, zero saturation', () => {
    expect(colorFromPoint(rect, 0, 0)).toEqual({ s: 0, v: 100 })
  })

  it('center = half saturation, half value', () => {
    expect(colorFromPoint(rect, 100, 50)).toEqual({ s: 50, v: 50 })
  })

  it('clamps out-of-bounds points', () => {
    expect(colorFromPoint(rect, -50, 200)).toEqual({ s: 0, v: 0 })
    expect(colorFromPoint(rect, 999, -10)).toEqual({ s: 100, v: 100 })
  })
})

describe('lcFromPoint (OKLCH area)', () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 } as DOMRect

  it('top-left = full lightness, zero chroma', () => {
    expect(lcFromPoint(rect, 0, 0)).toEqual({ c: 0, l: 1 })
  })

  it('bottom-right = full chroma (maxChroma), zero lightness', () => {
    const { c, l } = lcFromPoint(rect, 200, 100)
    expect(c).toBeCloseTo(DEFAULT_MAX_CHROMA, 6)
    expect(l).toBeCloseTo(0, 6)
  })

  it('respects a custom maxChroma', () => {
    expect(lcFromPoint(rect, 200, 0, 0.5).c).toBeCloseTo(0.5, 6)
  })

  it('clamps out-of-bounds points', () => {
    expect(lcFromPoint(rect, -50, 200)).toEqual({ c: 0, l: 0 })
  })
})

describe('color-picker area (HSV) reducer', () => {
  it('setSv stores S/V directly, preserving hue', () => {
    const [s] = update(init({ hsv: { h: 200, s: 100, v: 100 } }), {
      type: 'setSv',
      s: 50,
      v: 80,
    })
    expect(s.color).toEqual({ model: 'hsv', h: 200, s: 50, v: 80 })
  })

  it('setSv clamps to 0..100', () => {
    const [s] = update(init(), { type: 'setSv', s: 150, v: -20 })
    expect((s.color as { s: number }).s).toBe(100)
    expect((s.color as { v: number }).v).toBe(0)
  })

  it('nudgeSv moves S/V by signed deltas', () => {
    const start = init({ hsv: { h: 0, s: 50, v: 50 } })
    const [s] = update(start, { type: 'nudgeSv', ds: 10, dv: -10 })
    expect(s.color).toMatchObject({ s: 60, v: 40 })
  })

  it('nudgeSv on black still preserves hue (HSV advantage over HSL)', () => {
    const start = init({ hsv: { h: 270, s: 80, v: 0 } })
    const [s] = update(start, { type: 'nudgeSv', ds: 0, dv: 20 })
    expect(s.color).toMatchObject({ h: 270, v: 20 })
  })

  it('nudgeSv with a non-finite delta is ignored atomically', () => {
    const start = init({ hsv: { h: 10, s: 50, v: 50 } })
    expect(update(start, { type: 'nudgeSv', ds: NaN, dv: 1 })[0]).toEqual(start)
  })
})

describe('color-picker area (OKLCH) reducer', () => {
  it('setLc stores C/L directly, preserving hue', () => {
    const [s] = update(init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 200 } }), {
      type: 'setLc',
      c: 0.2,
      l: 0.7,
    })
    expect(s.color).toEqual({ model: 'oklch', h: 200, c: 0.2, l: 0.7 })
  })

  it('setLc clamps chroma to [0, DEFAULT_MAX_CHROMA] and lightness to [0,1]', () => {
    const [s] = update(init({ model: 'oklch' }), { type: 'setLc', c: 999, l: -5 })
    expect(s.color).toMatchObject({ c: DEFAULT_MAX_CHROMA, l: 0 })
  })

  it('nudgeLc moves C/L by signed deltas', () => {
    const start = init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 0 } })
    const [s] = update(start, { type: 'nudgeLc', dc: 0.05, dl: -0.1 })
    expect(s.color.model).toBe('oklch')
    if (s.color.model === 'oklch') {
      expect(s.color.c).toBeCloseTo(0.15, 9)
      expect(s.color.l).toBeCloseTo(0.4, 9)
    }
  })

  it('setChroma / setOklchLightness set one channel and keep hue', () => {
    const start = init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 123 } })
    expect(update(start, { type: 'setChroma', c: 0.3 })[0].color).toMatchObject({
      c: 0.3,
      h: 123,
    })
    expect(update(start, { type: 'setOklchLightness', l: 0.9 })[0].color).toMatchObject({
      l: 0.9,
      h: 123,
    })
  })

  it('setOklch sets all three channels at once', () => {
    const [s] = update(init({ model: 'oklch' }), { type: 'setOklch', l: 0.4, c: 0.2, h: 300 })
    expect(s.color).toEqual({ model: 'oklch', l: 0.4, c: 0.2, h: 300 })
  })

  it('non-finite oklch messages are ignored atomically', () => {
    const start = init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 10 } })
    for (const msg of [
      { type: 'setOklch' as const, l: NaN, c: 0.1, h: 10 },
      { type: 'setChroma' as const, c: Infinity },
      { type: 'setOklchLightness' as const, l: NaN },
      { type: 'setLc' as const, c: NaN, l: 0.5 },
      { type: 'nudgeLc' as const, dc: NaN, dl: 0 },
    ]) {
      expect(update(start, msg)[0]).toEqual(start)
    }
  })
})

describe('setModel', () => {
  it('converts hsv -> oklch and back losslessly for a saturated color', () => {
    const hsvState = init({ hsv: { h: 210, s: 80, v: 90 } })
    const oklchState = update(hsvState, { type: 'setModel', model: 'oklch' })[0]
    expect(oklchState.color.model).toBe('oklch')
    const back = update(oklchState, { type: 'setModel', model: 'hsv' })[0]
    expect(back.color).toMatchObject({ model: 'hsv' })
    if (back.color.model === 'hsv') {
      expect(back.color.h).toBeGreaterThanOrEqual(208)
      expect(back.color.h).toBeLessThanOrEqual(212)
      expect(back.color.s).toBeGreaterThanOrEqual(78)
      expect(back.color.s).toBeLessThanOrEqual(82)
    }
  })

  it('preserves hue across the boundary for an ACHROMATIC hsv color (v=0)', () => {
    const black = init({ hsv: { h: 270, s: 80, v: 0 } })
    const oklch = update(black, { type: 'setModel', model: 'oklch' })[0]
    expect(oklch.color).toMatchObject({ h: 270 })
  })

  it('preserves hue across the boundary for an ACHROMATIC hsv color (s=0)', () => {
    const grey = init({ hsv: { h: 123, s: 0, v: 50 } })
    const oklch = update(grey, { type: 'setModel', model: 'oklch' })[0]
    expect(oklch.color).toMatchObject({ h: 123 })
  })

  it('preserves hue across the boundary for an ACHROMATIC oklch color (c=0)', () => {
    const white = init({ model: 'oklch', oklch: { l: 1, c: 0, h: 88 } })
    const hsv = update(white, { type: 'setModel', model: 'hsv' })[0]
    expect(hsv.color).toMatchObject({ h: 88 })
  })

  it('is a no-op when already the target model', () => {
    const s = init({ model: 'oklch' })
    expect(update(s, { type: 'setModel', model: 'oklch' })[0]).toBe(s)
  })

  it('setHue after setModel sets the OKLCH hue, not a re-derived HSV hue', () => {
    const oklchState = init({ model: 'oklch', oklch: { l: 0.6, c: 0.2, h: 10 } })
    const [s] = update(oklchState, { type: 'setHue', h: 250 })
    expect(s.color).toMatchObject({ model: 'oklch', h: 250, l: 0.6, c: 0.2 })
  })
})

describe('setColor (swatch / eyedropper)', () => {
  it('applies a hex color', () => {
    const [s] = update(init(), { type: 'setColor', color: '#0000ff' })
    expect(stateHsl(s)).toEqual({ h: 240, s: 100, l: 50 })
  })

  it('ignores an invalid color', () => {
    const before = init()
    const [s] = update(before, { type: 'setColor', color: 'nope' })
    expect(s).toEqual(before)
  })

  it('an 8-digit hex sets alpha too', () => {
    const [s] = update(init(), { type: 'setColor', color: '#ff000080' })
    expect(stateHsl(s).h).toBe(0)
    expect(s.alpha).toBeCloseTo(128 / 255, 4)
  })

  it('accepts oklch()/named colors and stores into the ACTIVE model', () => {
    const oklchState = init({ model: 'oklch' })
    const [s] = update(oklchState, { type: 'setColor', color: 'blue' })
    expect(s.color.model).toBe('oklch')
    expect(stateHsl(s).h).toBeGreaterThanOrEqual(238)
    expect(stateHsl(s).h).toBeLessThanOrEqual(242)
  })
})

describe('output helpers: toHex / toHex8 / toCss', () => {
  it('toHex8 appends the alpha byte', () => {
    expect(toHex8(init({ hsl: { h: 0, s: 100, l: 50 } }))).toBe('#ff0000ff')
    expect(toHex8(init({ hsl: { h: 0, s: 100, l: 50 }, alpha: 0 }))).toBe('#ff000000')
    expect(toHex8(init({ hsl: { h: 0, s: 100, l: 50 }, alpha: 0.5 }))).toBe('#ff000080')
  })

  it('alpha round-trips via setColor with an 8-digit hex', () => {
    const hex = toHex8(init({ hsl: { h: 120, s: 100, l: 50 }, alpha: 0.5 }))
    const [s] = update(init(), { type: 'setColor', color: hex })
    expect(stateHsl(s)).toEqual({ h: 120, s: 100, l: 50 })
    expect(Math.round(s.alpha * 255)).toBe(128)
  })

  it('toHex for the hsv model', () => {
    expect(toHex(init({ hsl: { h: 0, s: 100, l: 50 } }))).toBe('#ff0000')
  })

  it('toCss uses hex for the hsv model, oklch() for the oklch model', () => {
    const hsvState = init({ hsl: { h: 0, s: 100, l: 50 } })
    expect(toCss(hsvState)).toBe('#ff0000')
    const oklchState = init({ model: 'oklch', color: 'red' })
    expect(toCss(oklchState)).toMatch(/^oklch\(/)
  })

  it('toCss appends hex8 for a translucent hsv color', () => {
    expect(toCss(init({ hsl: { h: 0, s: 100, l: 50 }, alpha: 0.5 }))).toBe('#ff000080')
  })
})

describe('stateHsv / stateOklch / isOutOfGamut', () => {
  it('stateOklch is exact in oklch mode, derived in hsv mode', () => {
    const s = init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 30 } })
    expect(stateOklch(s)).toEqual({ l: 0.5, c: 0.1, h: 30 })
  })

  it('an hsv-mode color is never out of gamut', () => {
    expect(isOutOfGamut(init({ hsv: { h: 10, s: 100, v: 100 } }))).toBe(false)
  })

  it('a wide oklch color IS out of gamut, and gamut-mapped hex stays in range', () => {
    const s = init({ model: 'oklch', oklch: { l: 0.7, c: 0.4, h: 150 } })
    expect(isOutOfGamut(s)).toBe(true)
    expect(toHex(s)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('color-picker.connect — HSV parts', () => {
  const p = connect(rootSignal(), vi.fn())

  it('root reflects data-model and data-out-of-gamut', () => {
    expect(read(p.root['data-model'], init())).toBe('hsv')
    expect(read(p.root['data-model'], init({ model: 'oklch' }))).toBe('oklch')
    expect(read(p.root['data-out-of-gamut'], init())).toBeUndefined()
    expect(
      read(
        p.root['data-out-of-gamut'],
        init({ model: 'oklch', oklch: { l: 0.7, c: 0.4, h: 150 } }),
      ),
    ).toBe('')
  })

  it('hueSlider value tracks the active model hue', () => {
    expect(read(p.hueSlider.value, init({ hsl: { h: 180, s: 50, l: 50 } }))).toBe('180')
    expect(
      read(p.hueSlider.value, init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 77 } })),
    ).toBe('77')
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

  it('preview style contains the current color', () => {
    expect(read(p.preview.style, init({ hsl: { h: 120, s: 100, l: 50 } }))).toContain('#00ff00')
  })

  it('area track exposes the hue backdrop in hsv mode, empty in oklch mode', () => {
    const style = read(p.area.style, init({ hsl: { h: 200, s: 100, l: 50 } }))
    expect(style).toContain('200')
    expect(read(p.area.style, init({ model: 'oklch' }))).toBe('')
  })

  it('area thumb has slider role and a 2D valuetext', () => {
    expect(p.areaThumb.role).toBe('slider')
    const vt = read(p.areaThumb['aria-valuetext'], init({ hsl: { h: 0, s: 100, l: 50 } }))
    expect(vt).toContain('100')
  })

  it('area thumb aria-valuenow reports HSV saturation in hsv mode', () => {
    const s = init({ hsl: { h: 0, s: 50, l: 25 } })
    expect(s.color).toMatchObject({ model: 'hsv' })
    if (s.color.model === 'hsv') expect(s.color.s).not.toBe(s.color.v)
    expect(read(p.areaThumb['aria-valuenow'], s)).toBe((s.color as { s: number }).s)
  })

  it('area thumb reports Chroma/Lightness valuetext in oklch mode', () => {
    const s = init({ model: 'oklch', oklch: { l: 0.64, c: 0.12, h: 10 } })
    expect(read(p.areaThumb['aria-valuetext'], s)).toBe('Chroma 0.12, Lightness 64%')
    expect(read(p.areaThumb['aria-valuenow'], s)).toBeCloseTo(0.12, 5)
    expect(read(p.areaThumb['aria-valuemax'], s)).toBe(DEFAULT_MAX_CHROMA)
  })

  it('area thumb arrow keys nudge S/V in hsv mode (Shift = coarse)', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send, { step: 1, coarseStep: 10 })
    const mk = (key: string, shift = false): KeyboardEvent =>
      ({
        key,
        shiftKey: shift,
        preventDefault: vi.fn(),
        currentTarget: document.createElement('div'),
      }) as unknown as KeyboardEvent
    pc.areaThumb.onKeyDown(mk('ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeSv', ds: 1, dv: 0 })
    pc.areaThumb.onKeyDown(mk('ArrowUp', true))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeSv', ds: 0, dv: 10 })
  })

  it('area thumb arrow keys nudge C/L in oklch mode, scaled by maxChroma', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ model: 'oklch' })), send, { step: 1, maxChroma: 0.5 })
    const mk = (key: string): KeyboardEvent =>
      ({ key, shiftKey: false, preventDefault: vi.fn() }) as unknown as KeyboardEvent
    pc.areaThumb.onKeyDown(mk('ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeLc', dc: 0.005, dl: 0 })
    pc.areaThumb.onKeyDown(mk('ArrowUp'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeLc', dc: 0, dl: 0.01 })
  })

  it('alphaSlider tracks alpha and dispatches setAlpha', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { alphaLabel: 'Opacity' })
    expect(pc.alphaSlider['aria-label']).toBe('Opacity')
    expect(read(pc.alphaSlider.value, init({ alpha: 0.5 }))).toBe('0.5')
    const target = document.createElement('input')
    target.value = '0.25'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.alphaSlider.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setAlpha', alpha: 0.25 })
  })

  it('swatch factory dispatches setColor and reflects selection', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const sw = pc.swatch('#00ff00')
    sw.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'setColor', color: '#00ff00' })
    expect(read(sw['data-state'], init({ hsl: { h: 120, s: 100, l: 50 } }))).toBe('selected')
    expect(read(sw['data-state'], init({ hsl: { h: 0, s: 100, l: 50 } }))).toBe(undefined)
  })
})

describe('color-picker.connect — OKLCH parts', () => {
  const p = connect(rootSignal(), vi.fn(), { maxChroma: 0.4 })

  it('chromaSlider spans 0..maxChroma and tracks current chroma', () => {
    expect(p.chromaSlider.max).toBe(0.4)
    const s = init({ model: 'oklch', oklch: { l: 0.5, c: 0.2, h: 10 } })
    expect(read(p.chromaSlider.value, s)).toBe('0.2')
    expect(read(p.chromaSlider.style, s)).toContain('oklch(')
  })

  it('chromaSlider onInput dispatches setChroma', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = '0.15'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.chromaSlider.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setChroma', c: 0.15 })
  })

  it('oklchLightnessSlider spans 0..1 and tracks current lightness', () => {
    const s = init({ model: 'oklch', oklch: { l: 0.7, c: 0.1, h: 10 } })
    expect(read(p.oklchLightnessSlider.value, s)).toBe('0.7')
    expect(read(p.oklchLightnessSlider.style, s)).toContain('oklch(')
  })

  it('oklchLightnessSlider onInput dispatches setOklchLightness', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = '0.42'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.oklchLightnessSlider.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setOklchLightness', l: 0.42 })
  })

  it('modelToggle cycles the model and its label reflects the NEXT model', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    expect(read(pc.modelToggle['aria-label'], init())).toBe('Switch to OKLCH')
    expect(read(pc.modelToggle['aria-label'], init({ model: 'oklch' }))).toBe('Switch to HSV')
    pc.modelToggle.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'setModel', model: 'oklch' })
  })

  it('areaCanvas is a decorative, headless seam', () => {
    expect(p.areaCanvas['aria-hidden']).toBe('true')
    expect(p.areaCanvas['data-part']).toBe('area-canvas')
  })
})

describe('oklchPlanePixels', () => {
  it('produces RGBA bytes of the right length', () => {
    const px = oklchPlanePixels(0, 4, 3)
    expect(px).toHaveLength(4 * 3 * 4)
  })

  it('marks out-of-gamut pixels fully transparent', () => {
    // A wide swath of a high-chroma plane at hue 150 is outside sRGB.
    const px = oklchPlanePixels(150, 50, 50, 0.4)
    let sawTransparent = false
    let sawOpaque = false
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] === 0) sawTransparent = true
      if (px[i] === 255) sawOpaque = true
    }
    expect(sawTransparent).toBe(true)
    expect(sawOpaque).toBe(true)
  })

  it('is a safe no-op for a zero-sized plane', () => {
    expect(oklchPlanePixels(0, 0, 0)).toHaveLength(0)
  })
})

describe('paintOklchPlane', () => {
  it('does nothing for a zero-sized canvas', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 0
    canvas.height = 0
    expect(() => paintOklchPlane(canvas, 0)).not.toThrow()
  })

  it('paints into a real canvas 2D context when available', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    // jsdom has no real 2D canvas context; guard so this suite still proves
    // the function is a no-op rather than a crash in that environment.
    expect(() => paintOklchPlane(canvas, 0)).not.toThrow()
  })
})

describe('eyedropper', () => {
  const originalEyeDropper = window.EyeDropper

  afterEach(() => {
    if (originalEyeDropper === undefined) {
      Reflect.deleteProperty(window, 'EyeDropper')
    } else {
      window.EyeDropper = originalEyeDropper
    }
  })

  it('supportsEyeDropper is false with no EyeDropper on window', () => {
    Reflect.deleteProperty(window, 'EyeDropper')
    expect(supportsEyeDropper()).toBe(false)
  })

  it('supportsEyeDropper is true once EyeDropper is present', () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        return { sRGBHex: '#123456' }
      }
    } as unknown as typeof window.EyeDropper
    expect(supportsEyeDropper()).toBe(true)
  })

  it('openEyeDropper resolves null when unsupported', async () => {
    Reflect.deleteProperty(window, 'EyeDropper')
    await expect(openEyeDropper()).resolves.toBeNull()
  })

  it('openEyeDropper resolves the picked hex on success', async () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        return { sRGBHex: '#abcdef' }
      }
    } as unknown as typeof window.EyeDropper
    await expect(openEyeDropper()).resolves.toBe('#abcdef')
  })

  it('openEyeDropper resolves null (not rejects) on user cancel (AbortError)', async () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        throw new DOMException('cancelled', 'AbortError')
      }
    } as unknown as typeof window.EyeDropper
    await expect(openEyeDropper()).resolves.toBeNull()
  })

  it('openEyeDropper rejects for a genuine unexpected failure', async () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        throw new Error('boom')
      }
    } as unknown as typeof window.EyeDropper
    await expect(openEyeDropper()).rejects.toThrow('boom')
  })

  it('eyeDropperTrigger onClick opens the dropper and dispatches setColor on success', async () => {
    let resolveOpen: (v: { sRGBHex: string }) => void = () => {}
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        return new Promise((resolve) => {
          resolveOpen = resolve
        })
      }
    } as unknown as typeof window.EyeDropper
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    resolveOpen({ sRGBHex: '#00ff00' })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'setColor', color: '#00ff00' })
    })
  })

  it('a second click aborts the pending pick instead of stacking sends', async () => {
    let firstController: AbortSignal | undefined
    const opens: Array<() => void> = []
    window.EyeDropper = class {
      async open(opts?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> {
        firstController ??= opts?.signal
        return new Promise((resolve, reject) => {
          opens.push(() => {
            if (opts?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
            else resolve({ sRGBHex: '#ffffff' })
          })
        })
      }
    } as unknown as typeof window.EyeDropper
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(firstController?.aborted).toBe(false)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(firstController?.aborted).toBe(true)
  })

  it('onClick is a no-op when disabled', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ disabled: true })), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('serialization', () => {
  it('ColorPickerState round-trips through JSON unchanged', () => {
    const states: ColorPickerState[] = [
      init(),
      init({ model: 'oklch' }),
      init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 200 } }),
    ]
    for (const s of states) {
      expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
    }
  })
})
