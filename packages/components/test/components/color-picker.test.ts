import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, toHex, hexToHsl, hslToRgb } from '../../src/components/color-picker'
import type { ColorPickerState } from '../../src/components/color-picker'

type Ctx = { c: ColorPickerState }
const wrap = (c: ColorPickerState): Ctx => ({ c })

describe('color-picker reducer', () => {
  it('initializes red', () => {
    expect(init().hsl).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('setHue wraps mod 360', () => {
    expect(update(init(), { type: 'setHue', h: 400 })[0].hsl.h).toBe(40)
    expect(update(init(), { type: 'setHue', h: -10 })[0].hsl.h).toBe(350)
  })

  it('setSaturation clamps 0..100', () => {
    expect(update(init(), { type: 'setSaturation', s: 150 })[0].hsl.s).toBe(100)
    expect(update(init(), { type: 'setSaturation', s: -50 })[0].hsl.s).toBe(0)
  })

  it('setHex accepts valid hex', () => {
    const [s] = update(init(), { type: 'setHex', hex: '#00ff00' })
    expect(s.hsl.h).toBe(120)
    expect(s.hsl.s).toBe(100)
    expect(s.hsl.l).toBe(50)
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

describe('color-picker.connect', () => {
  const p = connect<Ctx>((s) => s.c, vi.fn())

  it('hueSlider value tracks hue', () => {
    expect(p.hueSlider.value(wrap(init({ hsl: { h: 180, s: 50, l: 50 } })))).toBe('180')
  })

  it('hexInput value renders current color', () => {
    expect(p.hexInput.value(wrap(init({ hsl: { h: 0, s: 100, l: 50 } })))).toBe('#ff0000')
  })

  it('hueSlider onInput dispatches setHue', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.c, send)
    const target = document.createElement('input')
    target.value = '60'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.hueSlider.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setHue', h: 60 })
  })

  it('swatch style contains current hex', () => {
    expect(p.swatch.style(wrap(init({ hsl: { h: 120, s: 100, l: 50 } })))).toContain('#00ff00')
  })
})
