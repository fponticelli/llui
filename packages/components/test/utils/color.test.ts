import { describe, it, expect } from 'vitest'
import {
  hslToRgb255,
  rgb255ToHsl,
  hslToHsv,
  hsvToHsl,
  hsvToRgb255,
  rgb255ToHsv,
  srgb255ToSrgb,
  srgbToRgb255,
  srgbToLinear,
  linearToSrgb,
  linearSrgbToOklab,
  oklabToLinearSrgb,
  srgbToOklab,
  oklabToSrgb,
  oklabToOklch,
  oklchToOklab,
  srgbToOklch,
  oklchToSrgb,
  hsvToOklch,
  oklchToHsv,
  inSrgbGamut,
  gamutMapOklchToSrgb,
  formatHex,
  formatHex8,
  parseHexColor,
  parseCssColor,
  cssColorToSrgb,
  cssColorToHex,
  cssColorAlpha,
  formatRgb,
  formatOklch,
  interpolateColor,
  resolveNone,
  type CssColor,
} from '../../src/utils/color'

describe('HSV <-> RGB255', () => {
  it('round trips a saturated color', () => {
    const hsv = { h: 210, s: 80, v: 90 }
    const back = rgb255ToHsv(hsvToRgb255(hsv))
    expect(back.h).toBeGreaterThanOrEqual(hsv.h - 1)
    expect(back.h).toBeLessThanOrEqual(hsv.h + 1)
  })
})

describe('oklchToSrgb (unmapped)', () => {
  it('is NOT gamut-mapped — an out-of-gamut oklch color stays outside [0,1]', () => {
    const s = oklchToSrgb({ l: 0.7, c: 0.4, h: 150 })
    const outside = s.r < 0 || s.r > 1 || s.g < 0 || s.g > 1 || s.b < 0 || s.b > 1
    expect(outside).toBe(true)
  })
})

describe('HSL <-> RGB255', () => {
  it('primaries', () => {
    expect(hslToRgb255({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 })
    expect(hslToRgb255({ h: 120, s: 100, l: 50 })).toEqual({ r: 0, g: 255, b: 0 })
    expect(hslToRgb255({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('round trips within rounding tolerance', () => {
    const hsl = { h: 180, s: 50, l: 50 }
    const back = rgb255ToHsl(hslToRgb255(hsl))
    expect(back.h).toBeGreaterThanOrEqual(179)
    expect(back.h).toBeLessThanOrEqual(181)
  })
})

describe('HSL <-> HSV', () => {
  it('black: l=0 -> v=0, s=0', () => {
    const hsv = hslToHsv({ h: 0, s: 0, l: 0 })
    expect(hsv).toEqual({ h: 0, s: 0, v: 0 })
  })

  it('white: l=100 -> v=100, s=0', () => {
    expect(hslToHsv({ h: 0, s: 0, l: 100 })).toEqual({ h: 0, s: 0, v: 100 })
  })

  it('pure red HSL(0,100,50) <-> HSV(0,100,100)', () => {
    expect(hslToHsv({ h: 0, s: 100, l: 50 })).toEqual({ h: 0, s: 100, v: 100 })
    expect(hsvToHsl({ h: 0, s: 100, v: 100 })).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('never produces NaN across the grey axis', () => {
    for (const l of [0, 25, 50, 75, 100]) {
      const hsv = hslToHsv({ h: 0, s: 0, l })
      expect(Number.isNaN(hsv.s)).toBe(false)
      expect(Number.isNaN(hsv.v)).toBe(false)
    }
  })
})

describe('sRGB <-> linear sRGB', () => {
  it('0 and 1 are fixed points', () => {
    const lin = srgbToLinear({ r: 0, g: 0, b: 1 })
    expect(lin.r).toBe(0)
    expect(lin.g).toBe(0)
    expect(lin.b).toBeCloseTo(1, 12)
    const srgb = linearToSrgb({ r: 0, g: 1, b: 0 })
    expect(srgb.r).toBe(0)
    expect(srgb.g).toBeCloseTo(1, 12)
    expect(srgb.b).toBe(0)
  })

  it('round trips', () => {
    const s = { r: 0.7, g: 0.3, b: 0.9 }
    const back = linearToSrgb(srgbToLinear(s))
    expect(back.r).toBeCloseTo(s.r, 9)
    expect(back.g).toBeCloseTo(s.g, 9)
    expect(back.b).toBeCloseTo(s.b, 9)
  })

  it('mid-tone 0.5 decodes below the linear midpoint (gamma > 1)', () => {
    const lin = srgbToLinear({ r: 0.5, g: 0.5, b: 0.5 })
    expect(lin.r).toBeLessThan(0.5)
    expect(lin.r).toBeCloseTo(0.214041, 5)
  })
})

describe('linear sRGB <-> OKLab / OKLCH reference values (CSS Color 4)', () => {
  // #ff0000 -> oklch(0.62796 0.25768 29.2339), per the CSS Color 4 examples.
  it('pure red', () => {
    const ok = srgbToOklch(srgb255ToSrgb({ r: 255, g: 0, b: 0 }))
    expect(ok.l).toBeCloseTo(0.62796, 4)
    expect(ok.c).toBeCloseTo(0.25768, 4)
    expect(ok.h).toBeCloseTo(29.2339, 1)
  })

  it('white is achromatic at L=1', () => {
    const ok = srgbToOklch(srgb255ToSrgb({ r: 255, g: 255, b: 255 }))
    expect(ok.l).toBeCloseTo(1, 4)
    expect(ok.c).toBeCloseTo(0, 6)
  })

  it('black is achromatic at L=0', () => {
    const ok = srgbToOklch(srgb255ToSrgb({ r: 0, g: 0, b: 0 }))
    expect(ok.l).toBeCloseTo(0, 4)
    expect(ok.c).toBeCloseTo(0, 6)
  })

  it('OKLab <-> OKLCH round trips', () => {
    const lab = { l: 0.5, a: 0.1, b: -0.05 }
    const back = oklchToOklab(oklabToOklch(lab))
    expect(back.l).toBeCloseTo(lab.l, 9)
    expect(back.a).toBeCloseTo(lab.a, 9)
    expect(back.b).toBeCloseTo(lab.b, 9)
  })

  it('linear sRGB <-> OKLab round trips', () => {
    const s = { r: 0.3, g: 0.6, b: 0.2 }
    const back = oklabToLinearSrgb(linearSrgbToOklab(s))
    expect(back.r).toBeCloseTo(s.r, 6)
    expect(back.g).toBeCloseTo(s.g, 6)
    expect(back.b).toBeCloseTo(s.b, 6)
  })

  it('sRGB <-> OKLab full pipeline round trips', () => {
    const s = { r: 0.8, g: 0.1, b: 0.4 }
    const back = oklabToSrgb(srgbToOklab(s))
    expect(back.r).toBeCloseTo(s.r, 6)
    expect(back.g).toBeCloseTo(s.g, 6)
    expect(back.b).toBeCloseTo(s.b, 6)
  })
})

describe('hex <-> oklch round trip stability', () => {
  it('is stable through hex -> oklch -> hex for a sample of colors', () => {
    const hexes = ['#ff0000', '#00ff00', '#0000ff', '#336699', '#abcdef', '#101010', '#f5f5f5']
    for (const hex of hexes) {
      const parsed = parseHexColor(hex)!
      const srgb = srgb255ToSrgb(parsed.rgb)
      const oklch = srgbToOklch(srgb)
      const mapped = gamutMapOklchToSrgb(oklch)
      const back = srgbToRgb255(mapped)
      // sRGB colors are already in-gamut, so mapping should be a near no-op
      // and the round trip should land within one 8-bit step of rounding.
      expect(Math.abs(back.r - parsed.rgb.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.g - parsed.rgb.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.b - parsed.rgb.b)).toBeLessThanOrEqual(1)
    }
  })

  it('HSV -> OKLCH -> HSV round trips for saturated colors', () => {
    const hsv = { h: 210, s: 80, v: 90 }
    const back = oklchToHsv(hsvToOklch(hsv))
    expect(back.h).toBeGreaterThanOrEqual(hsv.h - 2)
    expect(back.h).toBeLessThanOrEqual(hsv.h + 2)
    expect(back.s).toBeGreaterThanOrEqual(hsv.s - 2)
    expect(back.s).toBeLessThanOrEqual(hsv.s + 2)
  })
})

describe('gamut mapping', () => {
  it('an in-gamut color is (almost) unchanged', () => {
    const ok = srgbToOklch(srgb255ToSrgb({ r: 100, g: 150, b: 200 }))
    expect(inSrgbGamut(ok)).toBe(true)
    const mapped = gamutMapOklchToSrgb(ok)
    expect(mapped.r).toBeCloseTo(100 / 255, 3)
    expect(mapped.g).toBeCloseTo(150 / 255, 3)
    expect(mapped.b).toBeCloseTo(200 / 255, 3)
  })

  it('oklch(0.7 0.4 150) is out of sRGB gamut and maps into it', () => {
    const ok = { l: 0.7, c: 0.4, h: 150 }
    expect(inSrgbGamut(ok)).toBe(false)
    const mapped = gamutMapOklchToSrgb(ok)
    expect(inSrgbGamut(srgbToOklch(mapped))).toBe(true)
    expect(mapped.r).toBeGreaterThanOrEqual(-1e-6)
    expect(mapped.r).toBeLessThanOrEqual(1 + 1e-6)
    expect(mapped.g).toBeGreaterThanOrEqual(-1e-6)
    expect(mapped.g).toBeLessThanOrEqual(1 + 1e-6)
    expect(mapped.b).toBeGreaterThanOrEqual(-1e-6)
    expect(mapped.b).toBeLessThanOrEqual(1 + 1e-6)
  })

  it('lightness beyond [0,1] clamps to white/black', () => {
    expect(gamutMapOklchToSrgb({ l: 1.5, c: 0.1, h: 30 })).toEqual({ r: 1, g: 1, b: 1 })
    expect(gamutMapOklchToSrgb({ l: -0.2, c: 0.1, h: 30 })).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('a very high chroma still lands in gamut after mapping', () => {
    const ok = { l: 0.5, c: 5, h: 0 }
    const mapped = gamutMapOklchToSrgb(ok)
    expect(inSrgbGamut(srgbToOklch(mapped))).toBe(true)
  })

  it('converges to the TIGHTEST in-gamut chroma, not just any in-gamut point', () => {
    // A loose "is it in gamut" / "is it in [0,1]" assertion cannot tell a
    // correct binary search from one that converges to the wrong point —
    // both land in-gamut. Pin the actual converged chroma for a known
    // out-of-gamut color: an algorithm that reduces chroma more than
    // necessary (e.g. a mutated convergence test that treats "close enough"
    // as "too far" or vice versa) changes this by several percent, measured.
    const mapped = gamutMapOklchToSrgb({ l: 0.7, c: 0.4, h: 150 })
    const effective = srgbToOklch(mapped)
    expect(effective.c).toBeCloseTo(0.2104, 3)
    expect(effective.l).toBeCloseTo(0.7091, 3)
    expect(effective.h).toBeCloseTo(147.065, 2)
    expect(srgbToRgb255(mapped)).toEqual({ r: 0, g: 194, b: 72 })
  })
})

describe('hex formatting', () => {
  it('formatHex / formatHex8', () => {
    expect(formatHex({ r: 255, g: 0, b: 0 })).toBe('#ff0000')
    expect(formatHex8({ r: 255, g: 0, b: 0 }, 1)).toBe('#ff0000ff')
    expect(formatHex8({ r: 255, g: 0, b: 0 }, 0)).toBe('#ff000000')
    expect(formatHex8({ r: 255, g: 0, b: 0 }, 0.5)).toBe('#ff000080')
  })
})

describe('parseHexColor', () => {
  it('3, 4, 6, 8 digit forms', () => {
    expect(parseHexColor('#f00')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
    expect(parseHexColor('#f00f')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
    expect(parseHexColor('#ff0000')).toEqual({ rgb: { r: 255, g: 0, b: 0 }, alpha: 1 })
    const withAlpha = parseHexColor('#ff000080')!
    expect(withAlpha.rgb).toEqual({ r: 255, g: 0, b: 0 })
    expect(withAlpha.alpha).toBeCloseTo(128 / 255, 4)
  })

  it('rejects invalid', () => {
    expect(parseHexColor('xyz')).toBeNull()
    expect(parseHexColor('#gg0000')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
  })
})

describe('parseCssColor', () => {
  it('hex forms', () => {
    expect(parseCssColor('#f00')).toMatchObject({ space: 'srgb', alpha: 1 })
    expect(cssColorToHex(parseCssColor('#f00')!)).toBe('#ff0000')
  })

  it('named colors, including transparent and rebeccapurple', () => {
    expect(cssColorToHex(parseCssColor('red')!)).toBe('#ff0000')
    expect(cssColorToHex(parseCssColor('REBECCAPURPLE')!)).toBe('#663399')
    expect(parseCssColor('transparent')).toEqual({ space: 'srgb', r: 0, g: 0, b: 0, alpha: 0 })
    expect(parseCssColor('not-a-color')).toBeNull()
  })

  it('rgb() legacy comma syntax', () => {
    const c = parseCssColor('rgb(255, 0, 0)')!
    expect(cssColorToHex(c)).toBe('#ff0000')
    const withAlpha = parseCssColor('rgba(255, 0, 0, 0.5)')!
    expect(cssColorAlpha(withAlpha)).toBeCloseTo(0.5, 4)
  })

  it('rgb() modern space/slash syntax, numbers and percentages', () => {
    expect(cssColorToHex(parseCssColor('rgb(255 0 0)')!)).toBe('#ff0000')
    expect(cssColorToHex(parseCssColor('rgb(100% 0% 0%)')!)).toBe('#ff0000')
    const withAlpha = parseCssColor('rgb(255 0 0 / 50%)')!
    expect(cssColorAlpha(withAlpha)).toBeCloseTo(0.5, 4)
  })

  it('hsl()/hsla() both syntaxes', () => {
    expect(cssColorToHex(parseCssColor('hsl(0, 100%, 50%)')!)).toBe('#ff0000')
    expect(cssColorToHex(parseCssColor('hsl(0 100% 50%)')!)).toBe('#ff0000')
    const withAlpha = parseCssColor('hsla(0, 100%, 50%, 0.25)')!
    expect(cssColorAlpha(withAlpha)).toBeCloseTo(0.25, 4)
  })

  it('oklch()', () => {
    const c = parseCssColor('oklch(0.62796 0.25768 29.2339)')!
    expect(c.space).toBe('oklch')
    const hex = cssColorToHex(c)
    expect(hex.toLowerCase()).toMatch(/^#fe0000|#ff0000|#fd0000/i)
  })

  it('oklch() with percentages and alpha', () => {
    const c = parseCssColor('oklch(62.796% 0.25768 29.2339 / 50%)')!
    expect(cssColorAlpha(c)).toBeCloseTo(0.5, 4)
    if (c.space === 'oklch') expect(c.l).toBeCloseTo(0.62796, 4)
  })

  it('oklab()', () => {
    const c = parseCssColor('oklab(0.62796 0.22486 0.12585)')!
    expect(c.space).toBe('oklab')
  })

  it('none components parse to null', () => {
    const c = parseCssColor('oklch(0.5 0 none)') as CssColor
    expect(c.space).toBe('oklch')
    if (c.space === 'oklch') {
      expect(c.h).toBeNull()
      expect(c.c).toBe(0)
    }
  })

  it('resolveNone treats missing as 0', () => {
    expect(resolveNone(null)).toBe(0)
    expect(resolveNone(5)).toBe(5)
  })

  it('never throws on garbage input', () => {
    expect(() => parseCssColor('')).not.toThrow()
    expect(() => parseCssColor('rgb(')).not.toThrow()
    expect(() => parseCssColor('oklch(a b c)')).not.toThrow()
    expect(parseCssColor('rgb(')).toBeNull()
    expect(parseCssColor('oklch(a b c)')).toBeNull()
  })
})

describe('formatRgb / formatOklch', () => {
  it('formatRgb', () => {
    expect(formatRgb({ r: 255, g: 0, b: 0 })).toBe('rgb(255 0 0)')
    expect(formatRgb({ r: 255, g: 0, b: 0 }, 0.5)).toBe('rgb(255 0 0 / 0.5)')
  })

  it('formatOklch uses fixed precision and round-trips through the parser', () => {
    const s = formatOklch({ l: 0.628, c: 0.2577, h: 29.2339 })
    expect(s).toBe('oklch(0.6280 0.2577 29.23)')
    const back = parseCssColor(s)!
    expect(back.space).toBe('oklch')
    if (back.space === 'oklch') {
      expect(back.l).toBeCloseTo(0.628, 3)
      expect(back.c).toBeCloseTo(0.2577, 3)
      expect(back.h).toBeCloseTo(29.23, 1)
    }
  })

  it('formatOklch with alpha', () => {
    expect(formatOklch({ l: 0.5, c: 0.1, h: 10 }, 0.4)).toBe('oklch(0.5000 0.1000 10.00 / 0.4)')
  })
})

describe('cssColorToSrgb', () => {
  it('resolves each space to sRGB, treating none as 0', () => {
    const black = cssColorToSrgb({ space: 'srgb', r: null, g: null, b: null, alpha: 1 })
    expect(black).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('interpolateColor — reference midpoints', () => {
  const red: CssColor = { space: 'srgb', r: 1, g: 0, b: 0, alpha: 1 }
  const blue: CssColor = { space: 'srgb', r: 0, g: 0, b: 1, alpha: 1 }

  it('srgb midpoint is the arithmetic mean', () => {
    const mid = interpolateColor(red, blue, 0.5, 'srgb')
    expect(mid.space).toBe('srgb')
    if (mid.space === 'srgb') {
      expect(mid.r).toBeCloseTo(0.5, 6)
      expect(mid.g).toBeCloseTo(0, 6)
      expect(mid.b).toBeCloseTo(0.5, 6)
    }
  })

  it('t=0 and t=1 return the endpoints (within float error)', () => {
    const at0 = interpolateColor(red, blue, 0, 'srgb')
    const at1 = interpolateColor(red, blue, 1, 'srgb')
    if (at0.space === 'srgb' && at1.space === 'srgb') {
      expect(at0.r).toBeCloseTo(1, 6)
      expect(at1.b).toBeCloseTo(1, 6)
    }
  })

  it('oklab midpoint sits between the two OKLab positions', () => {
    const mid = interpolateColor(red, blue, 0.5, 'oklab')
    expect(mid.space).toBe('oklab')
    const redLab = srgbToOklab({ r: 1, g: 0, b: 0 })
    const blueLab = srgbToOklab({ r: 0, g: 0, b: 1 })
    if (mid.space === 'oklab') {
      expect(mid.l).toBeCloseTo((redLab.l + blueLab.l) / 2, 6)
      expect(mid.a).toBeCloseTo((redLab.a + blueLab.a) / 2, 6)
      expect(mid.b).toBeCloseTo((redLab.b + blueLab.b) / 2, 6)
    }
  })

  it('hue methods: shorter vs longer go opposite ways around the wheel', () => {
    const a: CssColor = { space: 'hsl', h: 10, s: 100, l: 50, alpha: 1 }
    const b: CssColor = { space: 'hsl', h: 350, s: 100, l: 50, alpha: 1 }
    const shorter = interpolateColor(a, b, 0.5, 'hsl', 'shorter')
    const longer = interpolateColor(a, b, 0.5, 'hsl', 'longer')
    // shorter: 10 -> 350 the short way (through 0) averages to 0/360.
    if (shorter.space === 'hsl') expect(shorter.h).toBeCloseTo(0, 1)
    // longer: 10 -> 350 the long way (through 180) averages to 180.
    if (longer.space === 'hsl') expect(longer.h).toBeCloseTo(180, 1)
  })

  it('increasing always rotates upward, decreasing always downward', () => {
    const a: CssColor = { space: 'hsl', h: 350, s: 100, l: 50, alpha: 1 }
    const b: CssColor = { space: 'hsl', h: 10, s: 100, l: 50, alpha: 1 }
    const increasing = interpolateColor(a, b, 0.5, 'hsl', 'increasing')
    const decreasing = interpolateColor(a, b, 0.5, 'hsl', 'decreasing')
    // increasing: 350 -> 10 goes UP through 360/0 (350 -> 370 -> mod 360 = 10),
    // so its midpoint is 360 mod 360 = 0.
    if (increasing.space === 'hsl') expect(increasing.h).toBeCloseTo(0, 1)
    // decreasing: 350 -> 10 goes DOWN directly (10 is already <= 350), so its
    // midpoint is the plain average, 180.
    if (decreasing.space === 'hsl') expect(decreasing.h).toBeCloseTo(180, 1)
  })

  it("an achromatic stop takes the OTHER stop's hue (powerless hue, oklch)", () => {
    const white: CssColor = { space: 'oklch', l: 1, c: 0, h: 0, alpha: 1 }
    const red2: CssColor = { space: 'oklch', l: 0.628, c: 0.258, h: 29.23, alpha: 1 }
    const quarter = interpolateColor(white, red2, 0.25, 'oklch')
    // Hue should already read as red's hue at t=0.25 (no hue rotation, chroma
    // just ramps in), not some arbitrary blend from hue 0.
    if (quarter.space === 'oklch') expect(quarter.h).toBeCloseTo(29.23, 1)
  })

  it('an explicit none hue behaves the same as a powerless one', () => {
    const a: CssColor = { space: 'oklch', l: 0.5, c: 0.1, h: null, alpha: 1 }
    const b: CssColor = { space: 'oklch', l: 0.5, c: 0.1, h: 100, alpha: 1 }
    const mid = interpolateColor(a, b, 0.5, 'oklch')
    if (mid.space === 'oklch') expect(mid.h).toBeCloseTo(100, 6)
  })

  it('premultiplies alpha — a transparent stop does not smear its rgb into the mix', () => {
    // Interpolating opaque red with fully-transparent red: with straight
    // (non-premultiplied) rgb lerp, the midpoint rgb is unaffected either way
    // (both are pure red), so exercise it with a transparent BLUE endpoint
    // to make premultiplication observable in the ramp toward opaque red.
    const opaqueRed: CssColor = { space: 'srgb', r: 1, g: 0, b: 0, alpha: 1 }
    const transparentBlue: CssColor = { space: 'srgb', r: 0, g: 0, b: 1, alpha: 0 }
    const near1 = interpolateColor(opaqueRed, transparentBlue, 0.9, 'srgb')
    // Premultiplied: at t=0.9 alpha is 0.1, and the (still-divided-out) color
    // is dominated by the near-zero-weight red channel's premultiplied
    // contribution rather than a naive straight average (which would still
    // read r=0.1, b=0.9).
    if (near1.space === 'srgb') {
      expect(near1.alpha).toBeCloseTo(0.1, 6)
      // Straight lerp would give r=0.1; premultiplied un-mixing pulls r higher
      // because blue's contribution is weighted by its vanishing alpha.
      expect(near1.r).toBeGreaterThan(0.1)
      // The B side is where premultiplication actually does its work here:
      // blue's OWN channel (b=1) must be weighted by its OWN vanishing alpha
      // (0) before mixing, giving exactly 0 rather than blue's un-premultiplied
      // b=1 leaking through — asserting only `r` above cannot see a mutation
      // that drops premultiplication on the B endpoint specifically, since
      // red's `b` and blue's `r` are both already 0 either way.
      expect(near1.b).toBeCloseTo(0, 6)
    }
  })

  it('fully transparent to fully transparent does not divide by zero', () => {
    const a: CssColor = { space: 'srgb', r: 1, g: 0, b: 0, alpha: 0 }
    const b: CssColor = { space: 'srgb', r: 0, g: 0, b: 1, alpha: 0 }
    const mid = interpolateColor(a, b, 0.5, 'srgb')
    expect(Number.isFinite((mid as { r: number }).r)).toBe(true)
    expect(mid.alpha).toBe(0)
  })
})
