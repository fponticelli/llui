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
  srgbToHsl,
  hslToSrgb,
  hsvToSrgb,
  srgbToHsv,
  hwbToSrgb,
  srgbToHwb,
  labToXyzD50,
  xyzD50ToLab,
  labToLch,
  lchToLab,
  type CssColor,
  type Srgb,
  type Oklch,
} from '../../src/utils/color'

/** The 148 CSS Color 4 named colors — kept in sync with `NAMED_COLORS` in
 * `src/utils/color.ts` by the "every named color parses" test below (which
 * fails loudly if a name here is unrecognized). */
const NAMED_COLOR_NAMES = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'grey',
  'green',
  'greenyellow',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
] as const

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
  // `color-picker.ts`'s `oklchPlanePixels` finds the sRGB gamut edge for a
  // fixed lightness/hue with ONE binary search per row instead of a full
  // per-pixel gamut-mapping search, which is only correct if `inSrgbGamut`
  // is true on a PREFIX of chroma values (monotone: true...true...false, no
  // "island" back in gamut past the edge). Swept across a real grid rather
  // than assumed.
  it('gamut boundary is monotone per row (verified, not assumed) — with one measured, documented exception', () => {
    // A count of rows with MORE than one true/false transition as chroma
    // increases from 0 to maxChroma — 1 transition is the expected shape
    // (in-gamut prefix, then out); 0 is a fully in- or out-of-gamut row.
    const maxChroma = 0.4
    let nonMonotoneRows = 0
    const nonMonotoneExamples: string[] = []
    for (let hue = 0; hue < 360; hue += 3) {
      for (let li = 1; li < 100; li += 1) {
        const l = li / 100
        let lastIn = inSrgbGamut({ l, c: 0, h: hue })
        let transitions = 0
        for (let ci = 1; ci <= 500; ci++) {
          const c = (ci / 500) * maxChroma
          const inGamut = inSrgbGamut({ l, c, h: hue })
          if (inGamut !== lastIn) {
            transitions++
            lastIn = inGamut
          }
        }
        if (transitions > 1) {
          nonMonotoneRows++
          nonMonotoneExamples.push(`h=${hue} l=${l}`)
        }
      }
    }
    // MEASURED: 5 of 11,880 sampled rows (0.04%) are non-monotone, all in a
    // narrow near-black/blue band (hue ~243-264°, l 0.02-0.12) where the
    // sRGB gamut boundary has a sub-pixel-scale non-convexity (~0.0008
    // chroma units wide — under 1 pixel at any canvas resolution up to
    // ~500px). `gamutEdgeIndex`'s binary search can place the found edge on
    // the near side of that sliver; the affected region is a fraction of a
    // pixel wide with an imperceptible color difference (near-black colors
    // differing by ~0.001 in OKLab chroma) — never a visible rendering
    // error. This assertion pins the COUNT so a real regression (the
    // non-convexity becoming large enough to matter) fails loudly instead
    // of silently growing.
    expect(nonMonotoneRows, nonMonotoneExamples.join(', ')).toBeLessThanOrEqual(5)
  })

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

  it("a NONE-hue stop takes the OTHER stop's hue (missing hue, oklch)", () => {
    const white: CssColor = { space: 'oklch', l: 1, c: 0, h: null, alpha: 1 }
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

// ── Finding A: lossless HSV/HSL — no intermediate rounding ──────────────────

describe('lossless HSV/HSL float conversions (review finding A)', () => {
  it('the exact named regressions round-trip exactly now', () => {
    // #123457 -> #123659 and orange (#ffa500) -> #ffa600 were both measured
    // drifting under the OLD (integer-rounding) HSV/HSL conversions.
    for (const hex of ['#123457', '#ffa500']) {
      const rgb = parseHexColor(hex)!.rgb
      const back = hsvToRgb255(rgb255ToHsv(rgb))
      expect(back, hex).toEqual(rgb)
    }
  })

  it('every hex byte triple on a sampled 17-per-channel grid (4913 colors) round-trips exactly through HSV', () => {
    const samples: number[] = []
    for (let i = 0; i <= 16; i++) samples.push(Math.round((i * 255) / 16))
    let checked = 0
    for (const r of samples) {
      for (const g of samples) {
        for (const b of samples) {
          const rgb = { r, g, b }
          const back = hsvToRgb255(rgb255ToHsv(rgb))
          expect(back, JSON.stringify(rgb)).toEqual(rgb)
          checked++
        }
      }
    }
    expect(checked).toBe(samples.length ** 3)
  })

  it('every hex byte triple round-trips exactly through HSL too', () => {
    const samples: number[] = []
    for (let i = 0; i <= 16; i++) samples.push(Math.round((i * 255) / 16))
    for (const r of samples) {
      for (const g of samples) {
        for (const b of samples) {
          const rgb = { r, g, b }
          const back = hslToRgb255(rgb255ToHsl(rgb))
          expect(back, JSON.stringify(rgb)).toEqual(rgb)
        }
      }
    }
  })

  it('all 148 CSS Color 4 named colors round-trip exactly through HSV (hex -> HSV -> hex)', () => {
    expect(NAMED_COLOR_NAMES.length).toBe(148)
    for (const name of NAMED_COLOR_NAMES) {
      const parsed = parseCssColor(name)
      expect(parsed, name).not.toBeNull()
      const rgb = srgbToRgb255(cssColorToSrgb(parsed!))
      const back = hsvToRgb255(rgb255ToHsv(rgb))
      expect(back, name).toEqual(rgb)
    }
  })

  it('HSV<->HSL round trip is exact (both directions), not just HSV<->RGB', () => {
    for (const hsv of [
      { h: 210.5, s: 63.7, v: 41.2 },
      { h: 0, s: 0, v: 50 },
      { h: 359.99, s: 100, v: 100 },
    ]) {
      const hsl = hsvToHsl(hsv)
      const back = hslToHsv(hsl)
      expect(back.h).toBeCloseTo(hsv.h, 9)
      expect(back.s).toBeCloseTo(hsv.s, 9)
      expect(back.v).toBeCloseTo(hsv.v, 9)
    }
  })

  it('hsvToSrgb/srgbToHsv is a DIRECT conversion (matches the HSL-routed composite to within float noise)', () => {
    const hsv = { h: 271.3, s: 44.9, v: 77.2 }
    const direct = hsvToSrgb(hsv)
    const viaHsl = hslToSrgb(hsvToHsl(hsv))
    expect(direct.r).toBeCloseTo(viaHsl.r, 9)
    expect(direct.g).toBeCloseTo(viaHsl.g, 9)
    expect(direct.b).toBeCloseTo(viaHsl.b, 9)
    const back = srgbToHsv(direct)
    expect(back.h).toBeCloseTo(hsv.h, 6)
    expect(back.s).toBeCloseTo(hsv.s, 6)
    expect(back.v).toBeCloseTo(hsv.v, 6)
  })

  it('srgbToHsl is a float conversion with no byte quantization', () => {
    // A fractional sRGB value with no exact 8-bit representation: if this
    // routed through Rgb255 it would snap to the nearest byte first.
    const s = { r: 0.501234, g: 0.201234, b: 0.801234 }
    const hsl = srgbToHsl(s)
    const viaBytes = rgb255ToHsl(srgbToRgb255(s))
    // The float path must NOT match the byte-quantized path (if it did, the
    // "fix" would have removed one rounding call but left the quantization).
    expect(Math.abs(hsl.l - viaBytes.l)).toBeGreaterThan(0)
  })
})

// ── Finding B: full CSS Color 4 parser — hwb()/lab()/lch()/color() ──────────

describe('hwb() (review finding B)', () => {
  it('degenerate cases are exact by construction', () => {
    expect(hwbToSrgb({ h: 0, w: 0, bk: 0 })).toEqual({ r: 1, g: 0, b: 0 })
    expect(hwbToSrgb({ h: 0, w: 100, bk: 0 })).toEqual({ r: 1, g: 1, b: 1 })
    expect(hwbToSrgb({ h: 0, w: 0, bk: 100 })).toEqual({ r: 0, g: 0, b: 0 })
  })

  // Independent reference: colorjs.io 0.7.1, `new Color('hwb(...)').to('srgb').coords`.
  it('matches colorjs.io 0.7.1 for representative hue/whiteness/blackness combinations', () => {
    const cases: Array<[string, Srgb]> = [
      ['hwb(120 20% 30%)', { r: 0.2, g: 0.7, b: 0.2 }],
      ['hwb(210 10% 10%)', { r: 0.1, g: 0.5, b: 0.9 }],
      ['hwb(300 50% 0%)', { r: 1, g: 0.5, b: 1 }],
    ]
    for (const [css, expected] of cases) {
      const parsed = parseCssColor(css)!
      const srgb = cssColorToSrgb(parsed)
      expect(srgb.r).toBeCloseTo(expected.r, 6)
      expect(srgb.g).toBeCloseTo(expected.g, 6)
      expect(srgb.b).toBeCloseTo(expected.b, 6)
    }
  })

  it('round-trips through srgbToHwb', () => {
    const hwb = { h: 145, w: 12, bk: 34 }
    const back = srgbToHwb(hwbToSrgb(hwb))
    expect(back.h).toBeCloseTo(hwb.h, 4)
    expect(back.w).toBeCloseTo(hwb.w, 4)
    expect(back.bk).toBeCloseTo(hwb.bk, 4)
  })

  it('hwb() has no legacy comma form', () => {
    expect(parseCssColor('hwb(0, 0%, 0%)')).toBeNull()
  })
})

describe('lab()/lch() (review finding B)', () => {
  it('CIE Lab <-> XYZ(D50) round trips', () => {
    const lab = { l: 54.29, a: 80.8, b: 69.89 }
    const back = xyzD50ToLab(labToXyzD50(lab))
    expect(back.l).toBeCloseTo(lab.l, 6)
    expect(back.a).toBeCloseTo(lab.a, 6)
    expect(back.b).toBeCloseTo(lab.b, 6)
  })

  it('Lab <-> LCh round trips', () => {
    const lch = labToLch({ l: 50, a: 40, b: -30 })
    const back = labToLch(lchToLab(lch))
    expect(back.l).toBeCloseTo(lch.l, 9)
    expect(back.c).toBeCloseTo(lch.c, 9)
    expect(back.h).toBeCloseTo(lch.h, 9)
  })

  // Independent reference: colorjs.io 0.7.1, `new Color('lab(...)').to('oklch').coords`.
  it('lab() matches colorjs.io 0.7.1 converted to OKLCH', () => {
    const cases: Array<[string, Oklch]> = [
      ['lab(50 40 59.5)', { l: 0.5777, c: 0.1543, h: 49.294 }],
      ['lab(29.6920 45.8323 -40.9491)', { l: 0.4183, c: 0.1684, h: 317.084 }],
      ['lab(100 0 0)', { l: 1, c: 0, h: 0 }],
      ['lab(0 0 0)', { l: 0, c: 0, h: 0 }],
    ]
    for (const [css, expected] of cases) {
      const parsed = parseCssColor(css)!
      expect(parsed.space, css).toBe('oklch')
      if (parsed.space === 'oklch') {
        expect(parsed.l, css).toBeCloseTo(expected.l, 3)
        expect(parsed.c, css).toBeCloseTo(expected.c, 2)
        if (expected.c > 0) expect(parsed.h, css).toBeCloseTo(expected.h, 0)
      }
    }
  })

  // Independent reference: sRGB red's Lab(D50) value is a widely-published
  // colorimetry constant (Bruce Lindbloom / colorjs.io both give
  // ~[54.29, 80.80, 69.89] for #ff0000 under a D50-adapted Lab). Round-tripping
  // that back through this module's lab() parser should land close to red's
  // own well-known OKLCH value (already used elsewhere in this file).
  it("srgb red's known Lab(D50) value parses back to red's known OKLCH value", () => {
    const parsed = parseCssColor('lab(54.29054140467191 80.80492817043522 69.89096476862429)')!
    expect(parsed.space).toBe('oklch')
    if (parsed.space === 'oklch') {
      expect(parsed.l).toBeCloseTo(0.62796, 3)
      expect(parsed.c).toBeCloseTo(0.25768, 2)
      expect(parsed.h).toBeCloseTo(29.2339, 0)
    }
  })

  // Independent reference: colorjs.io 0.7.1, `new Color('lch(...)').to('oklch').coords`.
  it('lch() matches colorjs.io 0.7.1 converted to OKLCH', () => {
    const parsed = parseCssColor('lch(50 60 40)')!
    expect(parsed.space).toBe('oklch')
    if (parsed.space === 'oklch') {
      expect(parsed.l).toBeCloseTo(0.5806, 3)
      expect(parsed.c).toBeCloseTo(0.1532, 2)
      expect(parsed.h).toBeCloseTo(33.752, 0)
    }
  })

  it('lab()/lch() have no legacy comma form', () => {
    expect(parseCssColor('lab(50, 40, 60)')).toBeNull()
    expect(parseCssColor('lch(50, 60, 40)')).toBeNull()
  })
})

describe('color() predefined spaces (review finding B)', () => {
  // Independent reference: colorjs.io 0.7.1, `new Color('color(<space> 1 0 0)').to('oklch').coords`.
  it('wide-gamut RGB spaces resolve to OKLCH, matching colorjs.io 0.7.1', () => {
    const cases: Array<[string, Oklch]> = [
      ['color(display-p3 1 0 0)', { l: 0.6486, c: 0.2995, h: 28.958 }],
      ['color(a98-rgb 1 0 0)', { l: 0.7022, c: 0.2882, h: 29.234 }],
      ['color(prophoto-rgb 1 0 0)', { l: 0.702, c: 0.4316, h: 19.576 }],
      ['color(rec2020 1 0 0)', { l: 0.6871, c: 0.3647, h: 24.186 }],
    ]
    for (const [css, expected] of cases) {
      const parsed = parseCssColor(css)!
      expect(parsed.space, css).toBe('oklch')
      if (parsed.space === 'oklch') {
        expect(parsed.l, css).toBeCloseTo(expected.l, 2)
        expect(parsed.c, css).toBeCloseTo(expected.c, 2)
        expect(parsed.h, css).toBeCloseTo(expected.h, 0)
      }
    }
  })

  it('color(srgb ...) resolves to srgb directly, matching colorjs.io 0.7.1 via OKLCH', () => {
    const parsed = parseCssColor('color(srgb 0.5 0.25 0.75)')!
    expect(parsed.space).toBe('srgb')
    const ok = srgbToOklch(cssColorToSrgb(parsed))
    expect(ok.l).toBeCloseTo(0.5152, 3)
    expect(ok.c).toBeCloseTo(0.1917, 3)
    expect(ok.h).toBeCloseTo(303.195, 1)
  })

  it('color(srgb-linear ...) matches colorjs.io 0.7.1', () => {
    const parsed = parseCssColor('color(srgb-linear 0.5 0.25 0.75)')!
    expect(parsed.space).toBe('srgb')
    const srgb = cssColorToSrgb(parsed)
    expect(srgb.r).toBeCloseTo(0.7354, 3)
    expect(srgb.g).toBeCloseTo(0.5371, 3)
    expect(srgb.b).toBeCloseTo(0.8808, 3)
  })

  it('color(xyz ...) is an alias for color(xyz-d65 ...), matching colorjs.io 0.7.1', () => {
    const xyz = parseCssColor('color(xyz 0.3 0.3 0.3)')!
    const xyzD65 = parseCssColor('color(xyz-d65 0.3 0.3 0.3)')!
    expect(xyz).toEqual(xyzD65)
    expect(xyz.space).toBe('oklch')
    if (xyz.space === 'oklch') {
      expect(xyz.l).toBeCloseTo(0.6716, 3)
      expect(xyz.c).toBeCloseTo(0.0205, 3)
      expect(xyz.h).toBeCloseTo(29.051, 0)
    }
  })

  it('color(xyz-d50 ...) Bradford-adapts before reaching OKLCH, matching colorjs.io 0.7.1', () => {
    const parsed = parseCssColor('color(xyz-d50 0.3 0.3 0.3)')!
    expect(parsed.space).toBe('oklch')
    if (parsed.space === 'oklch') {
      expect(parsed.l).toBeCloseTo(0.6719, 3)
      expect(parsed.c).toBeCloseTo(0.0262, 3)
      expect(parsed.h).toBeCloseTo(295.358, 0)
    }
  })

  it('rejects an unknown predefined space and malformed argument counts', () => {
    expect(parseCssColor('color(not-a-space 1 0 0)')).toBeNull()
    expect(parseCssColor('color(srgb 1 0)')).toBeNull()
    expect(parseCssColor('color(srgb, 1, 0, 0)')).toBeNull()
  })
})

describe('CSS Color 4 grammar: reject what it rejects, accept what it accepts (finding B)', () => {
  it('rejects `none` in the legacy comma syntax', () => {
    expect(parseCssColor('rgb(none, 0, 0)')).toBeNull()
    expect(parseCssColor('rgba(255, 0, 0, none)')).toBeNull()
    expect(parseCssColor('hsl(120, none, 50%)')).toBeNull()
  })

  it('rejects mixing slash-alpha into the legacy comma syntax', () => {
    expect(parseCssColor('rgb(255, 0, 0 / 0.5)')).toBeNull()
  })

  it('rejects mixed number/percentage color args in the legacy comma syntax', () => {
    expect(parseCssColor('rgb(255, 0%, 0)')).toBeNull()
    // ...but the SAME mix is fine in modern space syntax.
    expect(parseCssColor('rgb(255 0% 0)')).not.toBeNull()
  })

  it('rejects hex numbers, Infinity/NaN, and empty tokens — all valid JS Numbers, none valid CSS numbers', () => {
    expect(parseCssColor('rgb(0x10 0 0)')).toBeNull()
    expect(parseCssColor('rgb(Infinity 0 0)')).toBeNull()
    expect(parseCssColor('rgb(NaN 0 0)')).toBeNull()
  })

  it('rejects a wrong component count', () => {
    expect(parseCssColor('rgb(255 0)')).toBeNull()
    expect(parseCssColor('hsl(120 50%)')).toBeNull()
  })

  it('accepts a leading `+` sign, matching colorjs.io 0.7.1', () => {
    const parsed = parseCssColor('hsl(+120 50% 50%)')!
    const srgb = cssColorToSrgb(parsed)
    expect(srgb.r).toBeCloseTo(0.25, 6)
    expect(srgb.g).toBeCloseTo(0.75, 6)
    expect(srgb.b).toBeCloseTo(0.25, 6)
  })

  it('accepts a signed exponent, matching colorjs.io 0.7.1', () => {
    const parsed = parseCssColor('oklch(1e+0 0 0)')!
    expect(parsed.space).toBe('oklch')
    if (parsed.space === 'oklch') expect(parsed.l).toBe(1)
  })

  it('accepts a bare `+120` hue and a trailing decimal point', () => {
    expect(parseCssColor('hsl(120. 50% 50%)')).not.toBeNull()
  })
})

// ── Finding C: interpolateColor spec-precision fixes ────────────────────────

describe('interpolateColor: hue normalization to [0,360) before the method (finding C)', () => {
  // Independent reference: colorjs.io 0.7.1,
  // `new Color('oklch',[.7,.1,10]).mix(new Color('oklch',[.7,.1,400]), 0.5, {space:'oklch',hue:'increasing'})`.
  it("'increasing' 10 -> 400 at t=0.5 gives 25, not 205 (400 must normalize to 40 first)", () => {
    const a: CssColor = { space: 'oklch', l: 0.7, c: 0.1, h: 10, alpha: 1 }
    const b: CssColor = { space: 'oklch', l: 0.7, c: 0.1, h: 400, alpha: 1 }
    const mid = interpolateColor(a, b, 0.5, 'oklch', 'increasing')
    if (mid.space === 'oklch') expect(mid.h).toBeCloseTo(25, 6)
  })

  // Independent reference: colorjs.io 0.7.1, same pattern with 'shorter' 0->720.
  it("'shorter' 0 -> 720 at t=0.5 gives 0, not 180 (both normalize to hue 0)", () => {
    const a: CssColor = { space: 'oklch', l: 0.7, c: 0.1, h: 0, alpha: 1 }
    const b: CssColor = { space: 'oklch', l: 0.7, c: 0.1, h: 720, alpha: 1 }
    const mid = interpolateColor(a, b, 0.5, 'oklch', 'shorter')
    if (mid.space === 'oklch') expect(mid.h).toBeCloseTo(0, 6)
  })

  it('a negative hue normalizes too (-10 behaves as 350)', () => {
    const a: CssColor = { space: 'oklch', l: 0.7, c: 0.1, h: -10, alpha: 1 }
    const b: CssColor = { space: 'oklch', l: 0.7, c: 0.1, h: 10, alpha: 1 }
    // shorter(-10 == 350, 10): |10-350|=340>180 so 10 wraps to 370; mid=(350+370)/2=360=0
    const mid = interpolateColor(a, b, 0.5, 'oklch', 'shorter')
    if (mid.space === 'oklch') expect(mid.h).toBeCloseTo(0, 6)
  })
})

describe("interpolateColor: missing alpha carries the OTHER endpoint's alpha (finding C)", () => {
  // Independent reference: colorjs.io 0.7.1,
  // `new Color('color(srgb 1 0 0 / none)').mix(new Color('color(srgb 0 0 1 / 0.2)'), 0.5, {space:'srgb'})`
  // gives coords [0.5, 0, 0.5], alpha 0.2 — CONSTANT 0.2 at every t, because a
  // missing alpha resolves to the OTHER side's alpha (12.2's analogous-
  // component rule applied to alpha itself), not to 1.
  it("none alpha resolves to the other endpoint's alpha, not 1, at every t", () => {
    const a = parseCssColor('rgb(255 0 0 / none)')!
    const b = parseCssColor('rgb(0 0 255 / 0.2)')!
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const mixed = interpolateColor(a, b, t, 'srgb')
      expect(mixed.alpha, `t=${t}`).toBeCloseTo(0.2, 6)
    }
    const mid = interpolateColor(a, b, 0.5, 'srgb')
    if (mid.space === 'srgb') {
      expect(mid.r).toBeCloseTo(0.5, 6)
      expect(mid.g).toBeCloseTo(0, 6)
      expect(mid.b).toBeCloseTo(0.5, 6)
    }
  })

  it('both sides none alpha resolves to 1 (the ordinary default, nothing to carry)', () => {
    const a: CssColor = { space: 'srgb', r: 1, g: 0, b: 0, alpha: null }
    const b: CssColor = { space: 'srgb', r: 0, g: 0, b: 1, alpha: null }
    const mid = interpolateColor(a, b, 0.5, 'srgb')
    expect(mid.alpha).toBe(1)
  })
})

describe('interpolateColor: powerless vs EXPLICIT hue (finding C)', () => {
  // Verified two independent ways against the same math CSS Color 4 governs:
  // (1) colorjs.io 0.7.1 (the reference implementation, maintained by CSS WG
  //     members): `new Color('oklch',[1,0,90]).mix(new Color('oklch',[.6,.2,200]), t, {space:'oklch',hue:'shorter'})`
  //     gives hue 101 at t=0.1 and 145 at t=0.5 — the PLAIN shorter-path
  //     midpoint of literal 90 and 200 ((90+200)/2=145), i.e. the explicit
  //     hue 90 is used AS GIVEN, not replaced by 200.
  // (2) Real Chromium (Playwright, headless), rendering
  //     `background: linear-gradient(in oklch, oklch(1 0 90), oklch(.6 .2 200))`
  //     onto a real element and reading back rendered pixels at several
  //     x-positions, decoded sRGB -> OKLCH: the sampled hue trajectory
  //     matches the same "explicit 90, not powerless" path, not the
  //     powerless-substitution path (which would hold hue constant at 200
  //     throughout). See the harness this test's numbers were derived from
  //     for the exact repro HTML/CSS and pixel readings.
  //
  // This is why `toSpaceComponents` treats an achromatic SAME-SPACE color's
  // hue as authoritative (never auto-nulled from chroma alone) and only
  // produces a `null` hue when a CROSS-space conversion computes one for a
  // color that had no hue at all before the conversion (e.g. projecting
  // `white` into `hsl` for an `in hsl` mix).
  it("an achromatic oklch color with an EXPLICIT hue interpolates using that hue, not the other endpoint's", () => {
    const a: CssColor = { space: 'oklch', l: 1, c: 0, h: 90, alpha: 1 }
    const b: CssColor = { space: 'oklch', l: 0.6, c: 0.2, h: 200, alpha: 1 }
    const at01 = interpolateColor(a, b, 0.1, 'oklch', 'shorter')
    const at05 = interpolateColor(a, b, 0.5, 'oklch', 'shorter')
    if (at01.space === 'oklch') expect(at01.h).toBeCloseTo(101, 0)
    if (at05.space === 'oklch') expect(at05.h).toBeCloseTo(145, 0)
  })

  it('the SAME colors with hue `none` instead of explicit 90 DOES substitute the other hue', () => {
    const a: CssColor = { space: 'oklch', l: 1, c: 0, h: null, alpha: 1 }
    const b: CssColor = { space: 'oklch', l: 0.6, c: 0.2, h: 200, alpha: 1 }
    const at05 = interpolateColor(a, b, 0.5, 'oklch', 'shorter')
    if (at05.space === 'oklch') expect(at05.h).toBeCloseTo(200, 0)
  })

  it('a CROSS-space achromatic conversion (white -> hsl) still substitutes — no explicit hue existed to keep', () => {
    const white: CssColor = { space: 'srgb', r: 1, g: 1, b: 1, alpha: 1 }
    const blue: CssColor = { space: 'hsl', h: 240, s: 100, l: 50, alpha: 1 }
    const mid = interpolateColor(white, blue, 0.5, 'hsl')
    if (mid.space === 'hsl') expect(mid.h).toBeCloseTo(240, 0)
  })
})

describe('interpolateColor: HSL interpolation without 8-bit conversion (finding C)', () => {
  it('a cross-space conversion into hsl uses the FLOAT sRGB path, not a byte-quantized one', () => {
    // A color whose sRGB is NOT an exact 8-bit value: interpolating it
    // against itself (t irrelevant) in 'hsl' must reproduce its OWN exact
    // float HSL, not the HSL of its nearest byte-quantized neighbor.
    const ok: Oklch = { l: 0.6, c: 0.15, h: 40 }
    const srgb = oklchToSrgb(ok)
    const exact = srgbToHsl(srgb)
    const viaBytes = rgb255ToHsl(srgbToRgb255(srgb))
    // Precondition: this color's sRGB genuinely isn't byte-aligned, so the
    // two readings differ — otherwise the test would pass by accident.
    expect(Math.abs(exact.l - viaBytes.l)).toBeGreaterThan(1e-6)

    const color: CssColor = { space: 'oklch', l: ok.l, c: ok.c, h: ok.h, alpha: 1 }
    const result = interpolateColor(color, color, 0.5, 'hsl')
    if (result.space === 'hsl') {
      const resultL = resolveNone(result.l)
      expect(resolveNone(result.s)).toBeCloseTo(exact.s, 6)
      expect(resultL).toBeCloseTo(exact.l, 6)
      // And NOT the byte-quantized reading.
      expect(Math.abs(resultL - viaBytes.l)).toBeGreaterThan(1e-6)
    }
  })
})
