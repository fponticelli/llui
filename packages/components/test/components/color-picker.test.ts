import { describe, it, expect, vi, afterEach } from 'vitest'
import { component, mountApp, button } from '@llui/dom'
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
  eyeDropperSupportMount,
  oklchPlanePixels,
  paintOklchPlane,
  DEFAULT_MAX_CHROMA,
  type ColorPickerState,
  type ColorPickerMsg,
} from '../../src/components/color-picker'
import { hslToHsv, hsvToHsl, inSrgbGamut } from '../../src/utils/color'
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

  it('area thumb arrow keys nudge C/L in oklch mode, scaled by state.maxChroma', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ model: 'oklch', maxChroma: 0.5 })), send, { step: 1 })
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
  const p = connect(rootSignal(), vi.fn())

  it('chromaSlider spans 0..state.maxChroma and tracks current chroma', () => {
    const s = init({ model: 'oklch', oklch: { l: 0.5, c: 0.2, h: 10 }, maxChroma: 0.4 })
    expect(read(p.chromaSlider.max, s)).toBe(0.4)
    expect(read(p.chromaSlider.step, s)).toBeCloseTo(0.4 / 200, 9)
    expect(read(p.chromaSlider.value, s)).toBe('0.2')
    expect(read(p.chromaSlider.style, s)).toContain('oklch(')
  })

  it('a DIFFERENT instance with a different maxChroma renders its own range', () => {
    const s = init({ model: 'oklch', maxChroma: 0.1 })
    expect(read(p.chromaSlider.max, s)).toBe(0.1)
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

describe('color-picker.connect — area pointer drag (machine-owned)', () => {
  function fakeArea(): {
    target: {
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
      setPointerCapture: ReturnType<typeof vi.fn>
      hasPointerCapture: ReturnType<typeof vi.fn>
      releasePointerCapture: ReturnType<typeof vi.fn>
      querySelector: ReturnType<typeof vi.fn>
    }
    thumb: { focus: ReturnType<typeof vi.fn> }
  } {
    const thumb = { focus: vi.fn() }
    return {
      target: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
        setPointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
        querySelector: vi.fn(() => thumb),
      },
      thumb,
    }
  }

  const pointerEvent = (
    target: unknown,
    overrides: Partial<{
      button: number
      clientX: number
      clientY: number
      pointerId: number
    }> = {},
  ): PointerEvent =>
    ({
      button: overrides.button ?? 0,
      pointerId: overrides.pointerId ?? 1,
      clientX: overrides.clientX ?? 100,
      clientY: overrides.clientY ?? 50,
      currentTarget: target,
    }) as unknown as PointerEvent

  it('onPointerDown (hsv mode) captures, dispatches setSv from the position, and focuses the thumb', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const { target, thumb } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target, { clientX: 100, clientY: 50 }))
    expect(target.setPointerCapture).toHaveBeenCalledWith(1)
    expect(send).toHaveBeenCalledWith({ type: 'setSv', s: 50, v: 50 })
    expect(thumb.focus).toHaveBeenCalledTimes(1)
  })

  it('onPointerDown (oklch mode) dispatches setLc, scaled by state.maxChroma', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ model: 'oklch', maxChroma: 0.5 })), send)
    const { target } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target, { clientX: 200, clientY: 0 }))
    expect(send).toHaveBeenCalledWith({ type: 'setLc', c: 0.5, l: 1 })
  })

  it('onPointerMove after a valid pointerdown keeps dispatching from the live position', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const { target } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target, { clientX: 0, clientY: 0 }))
    send.mockClear()
    pc.area.onPointerMove(pointerEvent(target, { clientX: 200, clientY: 100 }))
    expect(send).toHaveBeenCalledWith({ type: 'setSv', s: 100, v: 0 })
  })

  it('onPointerMove with no prior pointerdown is inert', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const { target } = fakeArea()
    pc.area.onPointerMove(pointerEvent(target))
    expect(send).not.toHaveBeenCalled()
  })

  it('onPointerUp releases capture and ends the drag (a further move is inert)', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const { target } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target))
    pc.area.onPointerUp(pointerEvent(target))
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
    send.mockClear()
    pc.area.onPointerMove(pointerEvent(target))
    expect(send).not.toHaveBeenCalled()
  })

  it('onPointerCancel behaves like onPointerUp', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const { target } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target))
    pc.area.onPointerCancel(pointerEvent(target))
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('a non-primary button is ignored — no capture, no dispatch', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const { target } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target, { button: 2 }))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('onPointerDown while disabled is ignored', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ disabled: true })), send)
    const { target } = fakeArea()
    pc.area.onPointerDown(pointerEvent(target))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
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

  // Finding D: the per-row binary search (`gamutEdgeIndex`) assumes in-gamut
  // chroma forms a PREFIX of the row and skips computing every pixel past the
  // edge it finds. That assumption — and the search itself — is only worth
  // trusting if it agrees with the naive "ask `inSrgbGamut` per pixel"
  // ground truth everywhere, not just on the one hue the original bug report
  // used. This checks alpha (in/out of gamut) byte for byte across a spread
  // of hues, including ones outside the ~5/11880-row exception this file's
  // `gamut mapping` describe block measures and documents.
  it('the fast per-row edge search agrees with a naive per-pixel inSrgbGamut check (byte for byte, several hues)', () => {
    const width = 64
    const height = 64
    const maxChroma = 0.37
    for (const hue of [0, 30, 90, 145, 180, 243, 265, 300, 359]) {
      const fast = oklchPlanePixels(hue, width, height, maxChroma)
      for (let y = 0; y < height; y++) {
        const l = 1 - y / (height - 1)
        for (let x = 0; x < width; x++) {
          const c = (x / (width - 1)) * maxChroma
          const idx = (y * width + x) * 4
          const expectedOpaque = inSrgbGamut({ l, c, h: hue })
          const actualOpaque = fast[idx + 3] === 255
          if (actualOpaque !== expectedOpaque) {
            throw new Error(
              `hue=${hue} x=${x} y=${y} l=${l.toFixed(4)} c=${c.toFixed(4)}: ` +
                `fast said ${actualOpaque ? 'in' : 'out'}, naive said ${expectedOpaque ? 'in' : 'out'}`,
            )
          }
        }
      }
    }
  })
})

describe('paintOklchPlane', () => {
  it('does nothing for a zero-sized canvas', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 0
    canvas.height = 0
    expect(() => paintOklchPlane(canvas, init({ model: 'oklch' }))).not.toThrow()
  })

  it('paints into a real canvas 2D context when available', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 10
    canvas.height = 10
    // jsdom has no real 2D canvas context; guard so this suite still proves
    // the function is a no-op rather than a crash in that environment.
    expect(() => paintOklchPlane(canvas, init({ model: 'oklch' }))).not.toThrow()
  })

  it('reads hue from the active model and maxChroma from state, not separate args', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    const state = init({ model: 'oklch', oklch: { l: 0.6, c: 0.1, h: 200 }, maxChroma: 0.2 })
    // No throw either way; the real assertion is the call SHAPE (state, not
    // hue/maxChroma positional args) compiling at all.
    expect(() => paintOklchPlane(canvas, state)).not.toThrow()
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

  /** `eyeDropperSupported` is ALWAYS `false` from `init()` (finding E) — a
   * test that needs the trigger enabled builds the state directly, the same
   * way `eyeDropperSupportMount` would after a real mount. */
  const supportedState = (opts: Parameters<typeof init>[0] = {}): ColorPickerState => ({
    ...init(opts),
    eyeDropperSupported: true,
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
    const pc = connect(signalOf(supportedState()), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    resolveOpen({ sRGBHex: '#00ff00' })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'setColor', color: '#00ff00' })
    })
  })

  it('a second click CANCELS the pending pick (toggle-cancel) rather than restarting it', async () => {
    const calls: Array<{ signal?: AbortSignal; resolve: (r: { sRGBHex: string }) => void }> = []
    window.EyeDropper = class {
      async open(opts?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> {
        return new Promise((resolve) => {
          calls.push({ signal: opts?.signal, resolve })
        })
      }
    } as unknown as typeof window.EyeDropper
    const send = vi.fn()
    const pc = connect(signalOf(supportedState()), send)

    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal?.aborted).toBe(false)

    // Second click: CANCELS the pending pick. No second EyeDropper.open()
    // call — a toggle button that reopens instead of closing would surprise
    // a user who clicked it to back out.
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal?.aborted).toBe(true)

    // Even if the cancelled EyeDropper call still resolves — a real
    // implementation rejects on an aborted signal, but a hostile or buggy
    // one might not — its STALE result must never reach `send`.
    calls[0]?.resolve({ sRGBHex: '#111111' })
    await Promise.resolve()
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()

    // A THIRD click starts a genuinely new pick.
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(calls).toHaveLength(2)
    calls[1]?.resolve({ sRGBHex: '#222222' })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'setColor', color: '#222222' })
    })
  })

  it('onClick is a no-op when disabled', () => {
    const send = vi.fn()
    const pc = connect(signalOf(supportedState({ disabled: true })), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })

  it('onClick is a no-op when unsupported (the default init() state)', () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        return { sRGBHex: '#00ff00' }
      }
    } as unknown as typeof window.EyeDropper
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })

  it('a genuine failure (not AbortError) clears pending state and dispatches eyeDropperFailed, never an unhandled rejection', async () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        throw new Error('permission denied')
      }
    } as unknown as typeof window.EyeDropper
    const send = vi.fn()
    const pc = connect(signalOf(supportedState()), send)
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({
        type: 'eyeDropperFailed',
        message: expect.stringContaining('permission denied') as unknown as string,
      })
    })
    // Pending was cleared — a THIRD click starts a fresh pick rather than
    // reading as "cancel" (there is nothing left to cancel).
    let opened = 0
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        opened++
        return { sRGBHex: '#00ff00' }
      }
    } as unknown as typeof window.EyeDropper
    pc.eyeDropperTrigger.onClick(new MouseEvent('click'))
    await vi.waitFor(() => expect(opened).toBe(1))
  })

  it('update: eyeDropperFailed is an observable no-op (nothing to store)', () => {
    const s = supportedState()
    expect(update(s, { type: 'eyeDropperFailed', message: 'boom' })[0]).toBe(s)
  })

  it('update: eyeDropperFailed applies even while disabled', () => {
    const s = supportedState({ disabled: true })
    expect(update(s, { type: 'eyeDropperFailed', message: 'boom' })[0]).toBe(s)
  })
})

describe('eyeDropperSupported (finding E: state, not consumer feature-detection)', () => {
  it('init() always starts unsupported, regardless of the real browser', () => {
    expect(init().eyeDropperSupported).toBe(false)
  })

  it('setEyeDropperSupported flips it, and is a no-op if already at that value', () => {
    const s = init()
    const [flipped] = update(s, { type: 'setEyeDropperSupported', supported: true })
    expect(flipped.eyeDropperSupported).toBe(true)
    const [same] = update(flipped, { type: 'setEyeDropperSupported', supported: true })
    expect(same).toBe(flipped)
  })

  it('setEyeDropperSupported applies even while disabled', () => {
    const s = init({ disabled: true })
    const [flipped] = update(s, { type: 'setEyeDropperSupported', supported: true })
    expect(flipped.eyeDropperSupported).toBe(true)
  })

  it('the trigger publishes hidden/disabled/data-unsupported from state, never from its own feature-detect', () => {
    const p = connect(rootSignal(), vi.fn())
    const unsupported = init()
    const supported = { ...init(), eyeDropperSupported: true }
    expect(read(p.eyeDropperTrigger.hidden, unsupported)).toBe(true)
    expect(read(p.eyeDropperTrigger.disabled, unsupported)).toBe(true)
    expect(read(p.eyeDropperTrigger['data-unsupported'], unsupported)).toBe('')
    expect(read(p.eyeDropperTrigger.hidden, supported)).toBe(false)
    expect(read(p.eyeDropperTrigger.disabled, supported)).toBe(false)
    expect(read(p.eyeDropperTrigger['data-unsupported'], supported)).toBeUndefined()
  })

  it('the picker-level disabled flag ALSO disables the trigger even when supported', () => {
    const p = connect(rootSignal(), vi.fn())
    const s = { ...init({ disabled: true }), eyeDropperSupported: true }
    expect(read(p.eyeDropperTrigger.disabled, s)).toBe(true)
    expect(read(p.eyeDropperTrigger.hidden, s)).toBe(false)
  })
})

describe('eyeDropperSupportMount (finding E: the one mount-time helper)', () => {
  const originalEyeDropper = window.EyeDropper
  afterEach(() => {
    if (originalEyeDropper === undefined) Reflect.deleteProperty(window, 'EyeDropper')
    else window.EyeDropper = originalEyeDropper
  })

  it('dispatches setEyeDropperSupported(true) once mounted when the browser supports it', async () => {
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        return { sRGBHex: '#000000' }
      }
    } as unknown as typeof window.EyeDropper
    const send = vi.fn<(msg: ColorPickerMsg) => void>()
    const def = component<ColorPickerState, ColorPickerMsg, never>({
      name: 'EyeDropperSupportMountTest',
      init: () => [init(), []],
      update: (s, msg) => update(s, msg),
      view: () => [eyeDropperSupportMount(send)],
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = mountApp(container, def)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'setEyeDropperSupported', supported: true })
    })
    app.dispose()
    container.remove()
  })

  it('dispatches setEyeDropperSupported(false) when unsupported', async () => {
    Reflect.deleteProperty(window, 'EyeDropper')
    const send = vi.fn()
    const def = component<ColorPickerState, ColorPickerMsg, never>({
      name: 'EyeDropperSupportMountTestFalse',
      init: () => [init(), []],
      update: (s, msg) => update(s, msg),
      view: () => [eyeDropperSupportMount((msg) => send(msg) as never)],
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = mountApp(container, def)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith({ type: 'setEyeDropperSupported', supported: false })
    })
    app.dispose()
    container.remove()
  })
})

describe('eyedropper: mounted disposal (finding F — mount, open, dispose, resolve -> no send)', () => {
  const originalEyeDropper = window.EyeDropper
  afterEach(() => {
    if (originalEyeDropper === undefined) Reflect.deleteProperty(window, 'EyeDropper')
    else window.EyeDropper = originalEyeDropper
  })

  it('a pick resolving AFTER the component is disposed never calls send', async () => {
    let resolveOpen: (v: { sRGBHex: string }) => void = () => {}
    window.EyeDropper = class {
      async open(): Promise<{ sRGBHex: string }> {
        return new Promise((resolve) => {
          resolveOpen = resolve
        })
      }
    } as unknown as typeof window.EyeDropper

    const sends: ColorPickerMsg[] = []
    const def = component<ColorPickerState, ColorPickerMsg, never>({
      name: 'EyeDropperDisposalTest',
      init: () => [{ ...init(), eyeDropperSupported: true }, []],
      update: (s, msg) => update(s, msg),
      view: ({ state, send }) => {
        const parts = connect(state, (msg) => {
          sends.push(msg)
          send(msg)
        })
        return [button({ ...parts.eyeDropperTrigger })]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = mountApp(container, def)
    const trigger = container.querySelector('button')!
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // Mount, open (pending), DISPOSE — before the pick resolves.
    app.dispose()
    container.remove()
    sends.length = 0

    resolveOpen({ sRGBHex: '#00ff00' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(sends).toEqual([])
  })
})

describe('serialization', () => {
  it('ColorPickerState round-trips through JSON unchanged', () => {
    const states: ColorPickerState[] = [
      init(),
      init({ model: 'oklch' }),
      init({ model: 'oklch', oklch: { l: 0.5, c: 0.1, h: 200 } }),
      init({ maxChroma: 0.2 }),
    ]
    for (const s of states) {
      expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
    }
  })
})

describe('maxChroma (state, not a connect() option)', () => {
  it('defaults to DEFAULT_MAX_CHROMA', () => {
    expect(init().maxChroma).toBe(DEFAULT_MAX_CHROMA)
  })

  it('accepts a valid override', () => {
    expect(init({ maxChroma: 0.2 }).maxChroma).toBe(0.2)
  })

  it('rejects non-finite or non-positive values, falling back to the default', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -0.5]) {
      expect(init({ maxChroma: bad }).maxChroma).toBe(DEFAULT_MAX_CHROMA)
    }
  })

  it('the reducer clamps chroma to THIS instance maxChroma, not the global default', () => {
    const narrow = init({ model: 'oklch', maxChroma: 0.1 })
    expect(update(narrow, { type: 'setChroma', c: 999 })[0].color).toMatchObject({ c: 0.1 })
    const wide = init({ model: 'oklch', maxChroma: 0.3 })
    expect(update(wide, { type: 'setChroma', c: 999 })[0].color).toMatchObject({ c: 0.3 })
  })

  it('setModel converts hsv -> oklch clamped to the instance maxChroma', () => {
    // Pure red is ~0.258 chroma in OKLCH — comfortably inside the 0.37
    // default but well outside a 0.1 ceiling.
    const narrow = init({ hsv: { h: 0, s: 100, v: 100 }, maxChroma: 0.1 })
    const [oklchState] = update(narrow, { type: 'setModel', model: 'oklch' })
    expect(oklchState.color).toMatchObject({ c: 0.1 })
  })

  it('setColor/setHex clamp an OKLCH-space CSS string to the instance maxChroma', () => {
    const narrow = init({ model: 'oklch', maxChroma: 0.1 })
    const [s] = update(narrow, { type: 'setColor', color: 'oklch(0.6 0.3 20)' })
    expect(s.color).toMatchObject({ c: 0.1 })
  })

  it('maxChroma is fixed for the component lifetime — no message changes it', () => {
    const s = init({ maxChroma: 0.2 })
    const [after] = update(s, { type: 'setHue', h: 90 })
    expect(after.maxChroma).toBe(0.2)
  })
})
