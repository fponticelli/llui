/**
 * Shared color math — conversions, CSS Color 4 parsing/serialization, sRGB
 * gamut mapping, and interpolation. Pure, allocation-light, no DOM.
 *
 * `color-picker.ts` is the first consumer; the (planned) `gradient-picker`
 * is the second — this module exists so both read from ONE implementation of
 * the OKLCH math and the CSS Color 4 rules instead of drifting like every
 * per-component copy in this package used to (see `utils/number.ts`'s header
 * for the shape of that failure mode).
 *
 * ## Conventions
 *
 * - `Hsl`/`Hsv`: `h` in degrees 0–360, `s`/`l`/`v` in 0–100 (matches the
 *   pre-existing `color-picker` scale, so the reducer's state and its tests
 *   keep their numbers).
 * - `Rgb255`: 0–255, integers after rounding.
 * - `Srgb`: 0–1 floats — the sRGB gamma-encoded value (what `#rrggbb` and
 *   `rgb()` describe).
 * - `Oklab`/`Oklch`: Björn Ottosson's OKLab, `L` 0–1, `h` in degrees. OKLCH
 *   values are NOT clamped to sRGB — `oklch(0.9 0.3 150)` is a valid CSS
 *   color outside sRGB, and only the sRGB/hex conversions gamut-map it.
 *
 * ## `none` components
 *
 * CSS Color 4 lets any component be the keyword `none`, and the "powerless
 * hue" case (an achromatic color has no meaningful hue) needs the same
 * representation so interpolation can tell "no hue" from "hue 0". Every
 * component of {@link CssColor} is therefore `number | null`, `null` standing
 * for `none`. Two rules apply everywhere a `null` reaches arithmetic:
 * 1. Outside interpolation, a missing component behaves as 0 (`resolveNone`).
 * 2. Inside {@link interpolateColor}, a missing component — hue or otherwise —
 *    takes the OTHER endpoint's value for that component (CSS Color 4 §12.2),
 *    which is what makes an achromatic stop take the other stop's hue.
 */

// ── Basic types ─────────────────────────────────────────────────────────────

/** HSL color. `h` 0–360 degrees, `s`/`l` 0–100. */
export interface Hsl {
  h: number
  s: number
  l: number
}

/** HSV color. `h` 0–360 degrees, `s`/`v` 0–100. */
export interface Hsv {
  h: number
  s: number
  v: number
}

/** 8-bit-per-channel sRGB, 0–255 (integers once produced by this module). */
export interface Rgb255 {
  r: number
  g: number
  b: number
}

/** sRGB, gamma-encoded, 0–1 per channel. May fall outside [0,1] as an
 * intermediate value (e.g. converted from an out-of-gamut OKLCH) — callers
 * that need an in-gamut result go through {@link gamutMapOklchToSrgb}. */
export interface Srgb {
  r: number
  g: number
  b: number
}

/** Oklab. `l` is 0–1 lightness; `a`/`b` are unbounded (±0.4 roughly spans
 * sRGB). */
export interface Oklab {
  l: number
  a: number
  b: number
}

/** OKLCH. `l` 0–1, `c` >= 0 (unbounded — `maxChroma` in the color picker is a
 * UI choice, not a property of the color space), `h` in degrees. */
export interface Oklch {
  l: number
  c: number
  h: number
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function normalizeHueDeg(h: number): number {
  return ((h % 360) + 360) % 360
}

/** A `null` (CSS `none`) component behaves as 0 outside interpolation. */
export function resolveNone(n: number | null): number {
  return n ?? 0
}

// ── HSL / HSV / RGB ──────────────────────────────────────────────────────────

/** Convert HSL (h 0-360, s/l 0-100) to RGB (0-255 each, rounded). */
export function hslToRgb255(hsl: Hsl): Rgb255 {
  const s = hsl.s / 100
  const l = hsl.l / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hsl.h / 60) % 2) - 1))
  const m = l - c / 2
  let r: number
  let g: number
  let b: number
  const h = normalizeHueDeg(hsl.h)
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/** Convert RGB (0-255 each) to HSL (h 0-360, s/l 0-100, rounded). */
export function rgb255ToHsl(rgb: Rgb255): Hsl {
  const rf = rgb.r / 255
  const gf = rgb.g / 255
  const bf = rgb.b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d) % 6
    else if (max === gf) h = (bf - rf) / d + 2
    else h = (rf - gf) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** Convert HSL (h 0-360, s/l 0-100) to HSV (h 0-360, s/v 0-100). */
export function hslToHsv(hsl: Hsl): Hsv {
  const l = hsl.l / 100
  const sl = hsl.s / 100
  const v = l + sl * Math.min(l, 1 - l)
  const s = v === 0 ? 0 : 2 * (1 - l / v)
  return { h: hsl.h, s: Math.round(s * 100), v: Math.round(v * 100) }
}

/** Convert HSV (h 0-360, s/v 0-100) to HSL (h 0-360, s/l 0-100). */
export function hsvToHsl(hsv: Hsv): Hsl {
  const v = hsv.v / 100
  const sv = hsv.s / 100
  const l = v * (1 - sv / 2)
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
  return { h: hsv.h, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hsvToRgb255(hsv: Hsv): Rgb255 {
  return hslToRgb255(hsvToHsl(hsv))
}

export function rgb255ToHsv(rgb: Rgb255): Hsv {
  return hslToHsv(rgb255ToHsl(rgb))
}

// ── sRGB float <-> 0-255 ─────────────────────────────────────────────────────

export function srgb255ToSrgb(rgb: Rgb255): Srgb {
  return { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 }
}

/** Rounds AND clamps into 0-255 — the boundary where an out-of-gamut float
 * (an un-mapped OKLCH conversion) must finally become a displayable byte. */
export function srgbToRgb255(s: Srgb): Rgb255 {
  return {
    r: Math.round(clamp01(s.r) * 255),
    g: Math.round(clamp01(s.g) * 255),
    b: Math.round(clamp01(s.b) * 255),
  }
}

// ── sRGB <-> linear sRGB (IEC 61966-2-1) ────────────────────────────────────

function srgbChannelToLinear(c: number): number {
  const abs = Math.abs(c)
  return abs <= 0.04045 ? c / 12.92 : Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4
}

function linearChannelToSrgb(c: number): number {
  const abs = Math.abs(c)
  return abs <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * abs ** (1 / 2.4) - 0.055)
}

export function srgbToLinear(s: Srgb): Srgb {
  return {
    r: srgbChannelToLinear(s.r),
    g: srgbChannelToLinear(s.g),
    b: srgbChannelToLinear(s.b),
  }
}

export function linearToSrgb(s: Srgb): Srgb {
  return {
    r: linearChannelToSrgb(s.r),
    g: linearChannelToSrgb(s.g),
    b: linearChannelToSrgb(s.b),
  }
}

// ── linear sRGB <-> OKLab <-> OKLCH ──────────────────────────────────────────
//
// Matrices are Björn Ottosson's, as given in the CSS Color 4 sample code
// (https://www.w3.org/TR/css-color-4/#color-conversion-code /
// https://bottosson.github.io/posts/oklab/).

export function linearSrgbToOklab(s: Srgb): Oklab {
  const l = 0.4122214708 * s.r + 0.5363325363 * s.g + 0.0514459929 * s.b
  const m = 0.2119034982 * s.r + 0.6806995451 * s.g + 0.1073969566 * s.b
  const ss = 0.0883024619 * s.r + 0.2817188376 * s.g + 0.6299787005 * s.b

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(ss)

  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

export function oklabToLinearSrgb(lab: Oklab): Srgb {
  const l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const s_ = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}

export function srgbToOklab(s: Srgb): Oklab {
  return linearSrgbToOklab(srgbToLinear(s))
}

/** NOT gamut-mapped — may return channels outside [0,1] for an OKLab/OKLCH
 * color outside sRGB. Use {@link gamutMapOklchToSrgb} for a displayable
 * result. */
export function oklabToSrgb(lab: Oklab): Srgb {
  return linearToSrgb(oklabToLinearSrgb(lab))
}

export function oklabToOklch(lab: Oklab): Oklch {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
  const h = normalizeHueDeg((Math.atan2(lab.b, lab.a) * 180) / Math.PI)
  return { l: lab.l, c, h }
}

export function oklchToOklab(ok: Oklch): Oklab {
  const hRad = (ok.h * Math.PI) / 180
  return { l: ok.l, a: ok.c * Math.cos(hRad), b: ok.c * Math.sin(hRad) }
}

export function srgbToOklch(s: Srgb): Oklch {
  return oklabToOklch(srgbToOklab(s))
}

/** NOT gamut-mapped. See {@link oklabToSrgb}. */
export function oklchToSrgb(ok: Oklch): Srgb {
  return oklabToSrgb(oklchToOklab(ok))
}

// ── Composite HSV <-> OKLCH (through sRGB) ──────────────────────────────────

export function hsvToOklch(hsv: Hsv): Oklch {
  return srgbToOklch(srgb255ToSrgb(hsvToRgb255(hsv)))
}

/** Gamut-maps into sRGB first — HSV cannot represent an out-of-gamut color. */
export function oklchToHsv(ok: Oklch): Hsv {
  return rgb255ToHsv(srgbToRgb255(gamutMapOklchToSrgb(ok)))
}

// ── sRGB gamut testing + CSS Color 4 gamut mapping ──────────────────────────

/** Whether `ok`, converted to sRGB, falls inside [0,1] on every channel
 * (within `epsilon` — floating-point round-trip noise). */
export function inSrgbGamut(ok: Oklch, epsilon = 1e-4): boolean {
  const s = oklchToSrgb(ok)
  return (
    s.r >= -epsilon &&
    s.r <= 1 + epsilon &&
    s.g >= -epsilon &&
    s.g <= 1 + epsilon &&
    s.b >= -epsilon &&
    s.b <= 1 + epsilon
  )
}

function clipSrgb(s: Srgb): Srgb {
  return { r: clamp01(s.r), g: clamp01(s.g), b: clamp01(s.b) }
}

function deltaEOK(a: Oklab, b: Oklab): number {
  const dl = a.l - b.l
  const da = a.a - b.a
  const db = a.b - b.b
  return Math.sqrt(dl * dl + da * da + db * db)
}

/**
 * CSS Color 4 §13.2 gamut mapping: reduce OKLCH chroma by binary search until
 * simple-clipping the result into sRGB is perceptually indistinguishable
 * (deltaEOK < the 0.02 JND) from the reduced color, then clip. Given an
 * already-in-gamut color this returns it converted (and defensively clipped
 * for float noise) rather than a no-op, so the result is always safe to hand
 * straight to {@link srgbToRgb255}.
 */
export function gamutMapOklchToSrgb(ok: Oklch): Srgb {
  if (ok.l >= 1) return { r: 1, g: 1, b: 1 }
  if (ok.l <= 0) return { r: 0, g: 0, b: 0 }
  if (inSrgbGamut(ok)) return clipSrgb(oklchToSrgb(ok))

  const JND = 0.02
  const EPSILON = 1e-4

  let current = ok
  let clipped = clipSrgb(oklchToSrgb(current))
  let e = deltaEOK(srgbToOklab(clipped), oklchToOklab(current))
  if (e < JND) return clipped

  let min = 0
  let max = ok.c
  let minInGamut = true

  while (max - min > EPSILON) {
    const chroma = (min + max) / 2
    current = { l: ok.l, c: chroma, h: ok.h }
    if (minInGamut && inSrgbGamut(current)) {
      min = chroma
      continue
    }
    clipped = clipSrgb(oklchToSrgb(current))
    e = deltaEOK(srgbToOklab(clipped), oklchToOklab(current))
    if (e < JND) {
      if (JND - e < EPSILON) return clipped
      minInGamut = false
      min = chroma
    } else {
      max = chroma
    }
  }
  return clipped
}

// ── Hex ──────────────────────────────────────────────────────────────────────

function hexByte(n: number): string {
  return Math.round(clamp01(n / 255) * 255)
    .toString(16)
    .padStart(2, '0')
}

export function formatHex(rgb: Rgb255): string {
  return `#${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}`
}

export function formatHex8(rgb: Rgb255, alpha: number): string {
  return `${formatHex(rgb)}${hexByte(clamp01(alpha) * 255)}`
}

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Returns `null` on anything
 * else, never throws. */
export function parseHexColor(hex: string): { rgb: Rgb255; alpha: number } | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null
  const expand = (c: string): number => parseInt(c.length === 1 ? c + c : c, 16)
  if (normalized.length === 3 || normalized.length === 4) {
    const r = expand(normalized[0]!)
    const g = expand(normalized[1]!)
    const b = expand(normalized[2]!)
    const alpha = normalized.length === 4 ? expand(normalized[3]!) / 255 : 1
    return { rgb: { r, g, b }, alpha }
  }
  if (normalized.length === 6 || normalized.length === 8) {
    const r = parseInt(normalized.slice(0, 2), 16)
    const g = parseInt(normalized.slice(2, 4), 16)
    const b = parseInt(normalized.slice(4, 6), 16)
    const alpha = normalized.length === 8 ? parseInt(normalized.slice(6, 8), 16) / 255 : 1
    return { rgb: { r, g, b }, alpha }
  }
  return null
}

// ── rgb()/oklch()/etc. as a generic model ───────────────────────────────────

/** A color as CSS Color 4 sees it: one of five spaces, every component
 * `number | null` (`null` = the `none` keyword). This is the type
 * {@link parseCssColor} returns and {@link interpolateColor} operates on —
 * the common currency between "a string the user typed" and "a color a
 * gradient stop needs to render". */
export type CssColor =
  | { space: 'srgb'; r: number | null; g: number | null; b: number | null; alpha: number | null }
  | {
      space: 'srgb-linear'
      r: number | null
      g: number | null
      b: number | null
      alpha: number | null
    }
  | { space: 'hsl'; h: number | null; s: number | null; l: number | null; alpha: number | null }
  | { space: 'oklab'; l: number | null; a: number | null; b: number | null; alpha: number | null }
  | { space: 'oklch'; l: number | null; c: number | null; h: number | null; alpha: number | null }

/** Interpolation / generic-conversion target spaces (CSS Color 4 §12). */
export type InterpolationSpace = 'srgb' | 'srgb-linear' | 'oklab' | 'oklch' | 'hsl'

/** Convert any {@link CssColor} into fully-resolved (non-null) `Srgb`,
 * treating `none` as 0 and NOT gamut-mapping (an oklch/oklab input outside
 * sRGB stays outside [0,1]). */
export function cssColorToSrgb(c: CssColor): Srgb {
  switch (c.space) {
    case 'srgb':
      return { r: resolveNone(c.r), g: resolveNone(c.g), b: resolveNone(c.b) }
    case 'srgb-linear':
      return linearToSrgb({ r: resolveNone(c.r), g: resolveNone(c.g), b: resolveNone(c.b) })
    case 'hsl':
      return srgb255ToSrgb(
        hslToRgb255({ h: resolveNone(c.h), s: resolveNone(c.s), l: resolveNone(c.l) }),
      )
    case 'oklab':
      return oklabToSrgb({ l: resolveNone(c.l), a: resolveNone(c.a), b: resolveNone(c.b) })
    case 'oklch':
      return oklchToSrgb({ l: resolveNone(c.l), c: resolveNone(c.c), h: resolveNone(c.h) })
  }
}

/** Resolved alpha (`none` -> 1, CSS Color 4's used value for a missing
 * alpha outside interpolation). */
export function cssColorAlpha(c: CssColor): number {
  return c.alpha ?? 1
}

/** Gamut-map (if needed) and convert to a displayable hex string.
 * `#rrggbb` when alpha is (resolved to) 1, `#rrggbbaa` otherwise. */
export function cssColorToHex(c: CssColor): string {
  const alpha = cssColorAlpha(c)
  const srgb =
    c.space === 'oklch' || c.space === 'oklab'
      ? gamutMapOklchToSrgb(
          c.space === 'oklch'
            ? { l: resolveNone(c.l), c: resolveNone(c.c), h: resolveNone(c.h) }
            : oklabToOklch({ l: resolveNone(c.l), a: resolveNone(c.a), b: resolveNone(c.b) }),
        )
      : clipSrgb(cssColorToSrgb(c))
  const rgb = srgbToRgb255(srgb)
  return alpha >= 1 ? formatHex(rgb) : formatHex8(rgb, alpha)
}

export function formatRgb(rgb: Rgb255, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb.r} ${rgb.g} ${rgb.b})`
    : `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${round(alpha, 4)})`
}

function round(n: number, decimals: number): string {
  const s = n.toFixed(decimals)
  // Trim trailing zeros but keep at least one fraction digit's worth of
  // precision readable — `0.5000` -> `0.5`, `0.0000` -> `0`.
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** `oklch(L C H)` / `oklch(L C H / A)`. Fixed precision: `L` as a 0–1
 * fraction at 4 dp, `C` at 4 dp, `H` at 2 dp — chosen so the string is stable
 * and round-trips through {@link parseCssColor} without drifting. */
export function formatOklch(ok: Oklch, alpha = 1): string {
  const l = ok.l.toFixed(4)
  const c = ok.c.toFixed(4)
  const h = normalizeHueDeg(ok.h).toFixed(2)
  return alpha >= 1 ? `oklch(${l} ${c} ${h})` : `oklch(${l} ${c} ${h} / ${round(alpha, 4)})`
}

// ── Parsing ──────────────────────────────────────────────────────────────────

interface ParsedComponent {
  value: number | null
}

/** `none`, a bare number, or a percentage scaled onto `[0, percentScale]`
 * (or `[-percentScale, percentScale]` when `signed`, for oklab's a/b). */
function parseComponent(
  token: string,
  percentScale: number,
  signed = false,
): ParsedComponent | null {
  if (token === 'none') return { value: null }
  if (token.endsWith('%')) {
    const n = Number(token.slice(0, -1))
    if (!Number.isFinite(n)) return null
    return { value: (n / 100) * percentScale }
  }
  void signed
  const n = Number(token)
  return Number.isFinite(n) ? { value: n } : null
}

/** A hue component: bare number (degrees), `<number>deg|grad|rad|turn`, or
 * `none`. */
function parseHueComponent(token: string): ParsedComponent | null {
  if (token === 'none') return { value: null }
  const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|grad|rad|turn)?$/i.exec(token)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2]?.toLowerCase()
  if (unit === 'grad') return { value: n * 0.9 }
  if (unit === 'rad') return { value: (n * 180) / Math.PI }
  if (unit === 'turn') return { value: n * 360 }
  return { value: n }
}

/** Split a CSS color function's argument list into its (up to 4) component
 * tokens and an optional alpha token, tolerating both legacy comma syntax
 * (`rgba(255, 0, 0, .5)`) and modern space/slash syntax
 * (`rgb(255 0 0 / 50%)`). */
function splitComponents(body: string): { comps: string[]; alpha: string | null } {
  let main = body
  let alpha: string | null = null
  const slashIdx = body.lastIndexOf('/')
  if (slashIdx !== -1) {
    main = body.slice(0, slashIdx)
    alpha = body.slice(slashIdx + 1).trim()
  }
  const hasComma = main.includes(',')
  const comps = (hasComma ? main.split(',') : main.split(/\s+/))
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (alpha === null && hasComma && comps.length === 4) {
    alpha = comps.pop() ?? null
  }
  return { comps, alpha }
}

function parseAlpha(token: string | null): ParsedComponent | null {
  if (token === null) return { value: 1 }
  return parseComponent(token, 1)
}

function parseRgbFunction(body: string): CssColor | null {
  const { comps, alpha } = splitComponents(body)
  if (comps.length !== 3) return null
  const r = parseComponent(comps[0]!, 255)
  const g = parseComponent(comps[1]!, 255)
  const b = parseComponent(comps[2]!, 255)
  const a = parseAlpha(alpha)
  if (!r || !g || !b || !a) return null
  return {
    space: 'srgb',
    r: r.value === null ? null : r.value / 255,
    g: g.value === null ? null : g.value / 255,
    b: b.value === null ? null : b.value / 255,
    alpha: a.value,
  }
}

function parseHslFunction(body: string): CssColor | null {
  const { comps, alpha } = splitComponents(body)
  if (comps.length !== 3) return null
  const h = parseHueComponent(comps[0]!)
  const s = parseComponent(comps[1]!, 100)
  const l = parseComponent(comps[2]!, 100)
  const a = parseAlpha(alpha)
  if (!h || !s || !l || !a) return null
  return { space: 'hsl', h: h.value, s: s.value, l: l.value, alpha: a.value }
}

function parseOklchFunction(body: string): CssColor | null {
  const { comps, alpha } = splitComponents(body)
  if (comps.length !== 3) return null
  const l = parseComponent(comps[0]!, 1)
  const c = parseComponent(comps[1]!, 0.4)
  const h = parseHueComponent(comps[2]!)
  const a = parseAlpha(alpha)
  if (!l || !c || !h || !a) return null
  return { space: 'oklch', l: l.value, c: c.value, h: h.value, alpha: a.value }
}

function parseOklabFunction(body: string): CssColor | null {
  const { comps, alpha } = splitComponents(body)
  if (comps.length !== 3) return null
  const l = parseComponent(comps[0]!, 1)
  const a1 = parseComponent(comps[1]!, 0.4, true)
  const b1 = parseComponent(comps[2]!, 0.4, true)
  const a = parseAlpha(alpha)
  if (!l || !a1 || !b1 || !a) return null
  return { space: 'oklab', l: l.value, a: a1.value, b: b1.value, alpha: a.value }
}

/** The 148 CSS Color 4 extended named colors (147 keywords, `gray`/`grey`
 * pairs included, plus `transparent` handled separately below). */
const NAMED_COLORS: Readonly<Record<string, Rgb255>> = Object.freeze({
  aliceblue: { r: 0xf0, g: 0xf8, b: 0xff },
  antiquewhite: { r: 0xfa, g: 0xeb, b: 0xd7 },
  aqua: { r: 0x00, g: 0xff, b: 0xff },
  aquamarine: { r: 0x7f, g: 0xff, b: 0xd4 },
  azure: { r: 0xf0, g: 0xff, b: 0xff },
  beige: { r: 0xf5, g: 0xf5, b: 0xdc },
  bisque: { r: 0xff, g: 0xe4, b: 0xc4 },
  black: { r: 0x00, g: 0x00, b: 0x00 },
  blanchedalmond: { r: 0xff, g: 0xeb, b: 0xcd },
  blue: { r: 0x00, g: 0x00, b: 0xff },
  blueviolet: { r: 0x8a, g: 0x2b, b: 0xe2 },
  brown: { r: 0xa5, g: 0x2a, b: 0x2a },
  burlywood: { r: 0xde, g: 0xb8, b: 0x87 },
  cadetblue: { r: 0x5f, g: 0x9e, b: 0xa0 },
  chartreuse: { r: 0x7f, g: 0xff, b: 0x00 },
  chocolate: { r: 0xd2, g: 0x69, b: 0x1e },
  coral: { r: 0xff, g: 0x7f, b: 0x50 },
  cornflowerblue: { r: 0x64, g: 0x95, b: 0xed },
  cornsilk: { r: 0xff, g: 0xf8, b: 0xdc },
  crimson: { r: 0xdc, g: 0x14, b: 0x3c },
  cyan: { r: 0x00, g: 0xff, b: 0xff },
  darkblue: { r: 0x00, g: 0x00, b: 0x8b },
  darkcyan: { r: 0x00, g: 0x8b, b: 0x8b },
  darkgoldenrod: { r: 0xb8, g: 0x86, b: 0x0b },
  darkgray: { r: 0xa9, g: 0xa9, b: 0xa9 },
  darkgreen: { r: 0x00, g: 0x64, b: 0x00 },
  darkgrey: { r: 0xa9, g: 0xa9, b: 0xa9 },
  darkkhaki: { r: 0xbd, g: 0xb7, b: 0x6b },
  darkmagenta: { r: 0x8b, g: 0x00, b: 0x8b },
  darkolivegreen: { r: 0x55, g: 0x6b, b: 0x2f },
  darkorange: { r: 0xff, g: 0x8c, b: 0x00 },
  darkorchid: { r: 0x99, g: 0x32, b: 0xcc },
  darkred: { r: 0x8b, g: 0x00, b: 0x00 },
  darksalmon: { r: 0xe9, g: 0x96, b: 0x7a },
  darkseagreen: { r: 0x8f, g: 0xbc, b: 0x8f },
  darkslateblue: { r: 0x48, g: 0x3d, b: 0x8b },
  darkslategray: { r: 0x2f, g: 0x4f, b: 0x4f },
  darkslategrey: { r: 0x2f, g: 0x4f, b: 0x4f },
  darkturquoise: { r: 0x00, g: 0xce, b: 0xd1 },
  darkviolet: { r: 0x94, g: 0x00, b: 0xd3 },
  deeppink: { r: 0xff, g: 0x14, b: 0x93 },
  deepskyblue: { r: 0x00, g: 0xbf, b: 0xff },
  dimgray: { r: 0x69, g: 0x69, b: 0x69 },
  dimgrey: { r: 0x69, g: 0x69, b: 0x69 },
  dodgerblue: { r: 0x1e, g: 0x90, b: 0xff },
  firebrick: { r: 0xb2, g: 0x22, b: 0x22 },
  floralwhite: { r: 0xff, g: 0xfa, b: 0xf0 },
  forestgreen: { r: 0x22, g: 0x8b, b: 0x22 },
  fuchsia: { r: 0xff, g: 0x00, b: 0xff },
  gainsboro: { r: 0xdc, g: 0xdc, b: 0xdc },
  ghostwhite: { r: 0xf8, g: 0xf8, b: 0xff },
  gold: { r: 0xff, g: 0xd7, b: 0x00 },
  goldenrod: { r: 0xda, g: 0xa5, b: 0x20 },
  gray: { r: 0x80, g: 0x80, b: 0x80 },
  grey: { r: 0x80, g: 0x80, b: 0x80 },
  green: { r: 0x00, g: 0x80, b: 0x00 },
  greenyellow: { r: 0xad, g: 0xff, b: 0x2f },
  honeydew: { r: 0xf0, g: 0xff, b: 0xf0 },
  hotpink: { r: 0xff, g: 0x69, b: 0xb4 },
  indianred: { r: 0xcd, g: 0x5c, b: 0x5c },
  indigo: { r: 0x4b, g: 0x00, b: 0x82 },
  ivory: { r: 0xff, g: 0xff, b: 0xf0 },
  khaki: { r: 0xf0, g: 0xe6, b: 0x8c },
  lavender: { r: 0xe6, g: 0xe6, b: 0xfa },
  lavenderblush: { r: 0xff, g: 0xf0, b: 0xf5 },
  lawngreen: { r: 0x7c, g: 0xfc, b: 0x00 },
  lemonchiffon: { r: 0xff, g: 0xfa, b: 0xcd },
  lightblue: { r: 0xad, g: 0xd8, b: 0xe6 },
  lightcoral: { r: 0xf0, g: 0x80, b: 0x80 },
  lightcyan: { r: 0xe0, g: 0xff, b: 0xff },
  lightgoldenrodyellow: { r: 0xfa, g: 0xfa, b: 0xd2 },
  lightgray: { r: 0xd3, g: 0xd3, b: 0xd3 },
  lightgreen: { r: 0x90, g: 0xee, b: 0x90 },
  lightgrey: { r: 0xd3, g: 0xd3, b: 0xd3 },
  lightpink: { r: 0xff, g: 0xb6, b: 0xc1 },
  lightsalmon: { r: 0xff, g: 0xa0, b: 0x7a },
  lightseagreen: { r: 0x20, g: 0xb2, b: 0xaa },
  lightskyblue: { r: 0x87, g: 0xce, b: 0xfa },
  lightslategray: { r: 0x77, g: 0x88, b: 0x99 },
  lightslategrey: { r: 0x77, g: 0x88, b: 0x99 },
  lightsteelblue: { r: 0xb0, g: 0xc4, b: 0xde },
  lightyellow: { r: 0xff, g: 0xff, b: 0xe0 },
  lime: { r: 0x00, g: 0xff, b: 0x00 },
  limegreen: { r: 0x32, g: 0xcd, b: 0x32 },
  linen: { r: 0xfa, g: 0xf0, b: 0xe6 },
  magenta: { r: 0xff, g: 0x00, b: 0xff },
  maroon: { r: 0x80, g: 0x00, b: 0x00 },
  mediumaquamarine: { r: 0x66, g: 0xcd, b: 0xaa },
  mediumblue: { r: 0x00, g: 0x00, b: 0xcd },
  mediumorchid: { r: 0xba, g: 0x55, b: 0xd3 },
  mediumpurple: { r: 0x93, g: 0x70, b: 0xdb },
  mediumseagreen: { r: 0x3c, g: 0xb3, b: 0x71 },
  mediumslateblue: { r: 0x7b, g: 0x68, b: 0xee },
  mediumspringgreen: { r: 0x00, g: 0xfa, b: 0x9a },
  mediumturquoise: { r: 0x48, g: 0xd1, b: 0xcc },
  mediumvioletred: { r: 0xc7, g: 0x15, b: 0x85 },
  midnightblue: { r: 0x19, g: 0x19, b: 0x70 },
  mintcream: { r: 0xf5, g: 0xff, b: 0xfa },
  mistyrose: { r: 0xff, g: 0xe4, b: 0xe1 },
  moccasin: { r: 0xff, g: 0xe4, b: 0xb5 },
  navajowhite: { r: 0xff, g: 0xde, b: 0xad },
  navy: { r: 0x00, g: 0x00, b: 0x80 },
  oldlace: { r: 0xfd, g: 0xf5, b: 0xe6 },
  olive: { r: 0x80, g: 0x80, b: 0x00 },
  olivedrab: { r: 0x6b, g: 0x8e, b: 0x23 },
  orange: { r: 0xff, g: 0xa5, b: 0x00 },
  orangered: { r: 0xff, g: 0x45, b: 0x00 },
  orchid: { r: 0xda, g: 0x70, b: 0xd6 },
  palegoldenrod: { r: 0xee, g: 0xe8, b: 0xaa },
  palegreen: { r: 0x98, g: 0xfb, b: 0x98 },
  paleturquoise: { r: 0xaf, g: 0xee, b: 0xee },
  palevioletred: { r: 0xdb, g: 0x70, b: 0x93 },
  papayawhip: { r: 0xff, g: 0xef, b: 0xd5 },
  peachpuff: { r: 0xff, g: 0xda, b: 0xb9 },
  peru: { r: 0xcd, g: 0x85, b: 0x3f },
  pink: { r: 0xff, g: 0xc0, b: 0xcb },
  plum: { r: 0xdd, g: 0xa0, b: 0xdd },
  powderblue: { r: 0xb0, g: 0xe0, b: 0xe6 },
  purple: { r: 0x80, g: 0x00, b: 0x80 },
  rebeccapurple: { r: 0x66, g: 0x33, b: 0x99 },
  red: { r: 0xff, g: 0x00, b: 0x00 },
  rosybrown: { r: 0xbc, g: 0x8f, b: 0x8f },
  royalblue: { r: 0x41, g: 0x69, b: 0xe1 },
  saddlebrown: { r: 0x8b, g: 0x45, b: 0x13 },
  salmon: { r: 0xfa, g: 0x80, b: 0x72 },
  sandybrown: { r: 0xf4, g: 0xa4, b: 0x60 },
  seagreen: { r: 0x2e, g: 0x8b, b: 0x57 },
  seashell: { r: 0xff, g: 0xf5, b: 0xee },
  sienna: { r: 0xa0, g: 0x52, b: 0x2d },
  silver: { r: 0xc0, g: 0xc0, b: 0xc0 },
  skyblue: { r: 0x87, g: 0xce, b: 0xeb },
  slateblue: { r: 0x6a, g: 0x5a, b: 0xcd },
  slategray: { r: 0x70, g: 0x80, b: 0x90 },
  slategrey: { r: 0x70, g: 0x80, b: 0x90 },
  snow: { r: 0xff, g: 0xfa, b: 0xfa },
  springgreen: { r: 0x00, g: 0xff, b: 0x7f },
  steelblue: { r: 0x46, g: 0x82, b: 0xb4 },
  tan: { r: 0xd2, g: 0xb4, b: 0x8c },
  teal: { r: 0x00, g: 0x80, b: 0x80 },
  thistle: { r: 0xd8, g: 0xbf, b: 0xd8 },
  tomato: { r: 0xff, g: 0x63, b: 0x47 },
  turquoise: { r: 0x40, g: 0xe0, b: 0xd0 },
  violet: { r: 0xee, g: 0x82, b: 0xee },
  wheat: { r: 0xf5, g: 0xde, b: 0xb3 },
  white: { r: 0xff, g: 0xff, b: 0xff },
  whitesmoke: { r: 0xf5, g: 0xf5, b: 0xf5 },
  yellow: { r: 0xff, g: 0xff, b: 0x00 },
  yellowgreen: { r: 0x9a, g: 0xcd, b: 0x32 },
})

/**
 * Parse a CSS color string into its typed model. Supports `#rgb`/`#rgba`/
 * `#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()` (legacy comma and modern
 * space/slash, numbers and percentages), `hsl()`/`hsla()` (same two
 * syntaxes), `oklch()`, `oklab()`, `none` components, `transparent`, and the
 * 148 CSS Color 4 named colors. Returns `null` on anything else — never
 * throws.
 */
export function parseCssColor(input: string): CssColor | null {
  const s = input.trim().toLowerCase()
  if (s.length === 0) return null
  if (s === 'transparent') return { space: 'srgb', r: 0, g: 0, b: 0, alpha: 0 }
  if (s.startsWith('#')) {
    const parsed = parseHexColor(s)
    if (!parsed) return null
    return {
      space: 'srgb',
      r: parsed.rgb.r / 255,
      g: parsed.rgb.g / 255,
      b: parsed.rgb.b / 255,
      alpha: parsed.alpha,
    }
  }
  const named = NAMED_COLORS[s]
  if (named)
    return { space: 'srgb', r: named.r / 255, g: named.g / 255, b: named.b / 255, alpha: 1 }
  const fn = /^([a-z]+)\((.*)\)$/s.exec(s)
  if (!fn) return null
  const name = fn[1]!
  const body = fn[2]!
  switch (name) {
    case 'rgb':
    case 'rgba':
      return parseRgbFunction(body)
    case 'hsl':
    case 'hsla':
      return parseHslFunction(body)
    case 'oklch':
      return parseOklchFunction(body)
    case 'oklab':
      return parseOklabFunction(body)
    default:
      return null
  }
}

// ── Interpolation (CSS Color 4 §12) ─────────────────────────────────────────

export type HueInterpolationMethod = 'shorter' | 'longer' | 'increasing' | 'decreasing'

/** Adjust `h2` relative to `h1` per the hue interpolation method, returning
 * `[h1, h2]` such that a plain `lerp` between them (then normalizing mod 360)
 * gives the correct path. `h1` is never adjusted. */
function adjustHue(h1: number, h2raw: number, method: HueInterpolationMethod): [number, number] {
  let h2 = h2raw
  const diff = h2 - h1
  switch (method) {
    case 'shorter':
      if (diff > 180) h2 -= 360
      else if (diff < -180) h2 += 360
      break
    case 'longer':
      if (diff > 0 && diff < 180) h2 -= 360
      else if (diff > -180 && diff <= 0) h2 += 360
      break
    case 'increasing':
      if (h2 < h1) h2 += 360
      break
    case 'decreasing':
      if (h2 > h1) h2 -= 360
      break
  }
  return [h1, h2]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

interface SpaceComponents {
  /** Non-hue components, in the space's own units — premultiplied by alpha
   * during interpolation. */
  channels: readonly (number | null)[]
  /** The hue component (degrees), if this space has one. */
  hue: number | null
  /** Whether the color is achromatic in this space (hue is "powerless" —
   * CSS Color 4 §12.2 — and should be treated as missing for interpolation
   * even when a concrete number is stored). */
  achromatic: boolean
}

function toSpaceComponents(c: CssColor, space: InterpolationSpace): SpaceComponents {
  if (c.space === space) {
    switch (c.space) {
      case 'srgb':
      case 'srgb-linear':
        return { channels: [c.r, c.g, c.b], hue: null, achromatic: false }
      case 'hsl':
        return {
          channels: [c.s, c.l],
          hue: c.h,
          achromatic: resolveNone(c.s) === 0,
        }
      case 'oklab':
        return { channels: [c.l, c.a, c.b], hue: null, achromatic: false }
      case 'oklch':
        return {
          channels: [c.l, c.c],
          hue: c.h,
          achromatic: resolveNone(c.c) === 0,
        }
    }
  }
  // Cross-space: materialize through the fully-resolved math (a `none`
  // component here has already been treated as 0, which is the CSS Color 4
  // rule for a value used outside the color's OWN space).
  switch (space) {
    case 'srgb': {
      const s = cssColorToSrgb(c)
      return { channels: [s.r, s.g, s.b], hue: null, achromatic: false }
    }
    case 'srgb-linear': {
      const s = srgbToLinear(cssColorToSrgb(c))
      return { channels: [s.r, s.g, s.b], hue: null, achromatic: false }
    }
    case 'hsl': {
      const hsl = rgb255ToHsl(srgbToRgb255(cssColorToSrgb(c)))
      return { channels: [hsl.s, hsl.l], hue: hsl.h, achromatic: hsl.s === 0 }
    }
    case 'oklab': {
      const lab = srgbToOklab(cssColorToSrgb(c))
      return { channels: [lab.l, lab.a, lab.b], hue: null, achromatic: false }
    }
    case 'oklch': {
      const ok = srgbToOklch(cssColorToSrgb(c))
      return { channels: [ok.l, ok.c], hue: ok.h, achromatic: ok.c < 1e-6 }
    }
  }
}

function fromSpaceComponents(
  space: InterpolationSpace,
  channels: readonly number[],
  hue: number,
  alpha: number,
): CssColor {
  switch (space) {
    case 'srgb':
      return { space: 'srgb', r: channels[0]!, g: channels[1]!, b: channels[2]!, alpha }
    case 'srgb-linear':
      return { space: 'srgb-linear', r: channels[0]!, g: channels[1]!, b: channels[2]!, alpha }
    case 'hsl':
      return { space: 'hsl', h: normalizeHueDeg(hue), s: channels[0]!, l: channels[1]!, alpha }
    case 'oklab':
      return { space: 'oklab', l: channels[0]!, a: channels[1]!, b: channels[2]!, alpha }
    case 'oklch':
      return { space: 'oklch', l: channels[0]!, c: channels[1]!, h: normalizeHueDeg(hue), alpha }
  }
}

/**
 * Interpolate between two colors per CSS Color 4 §12: convert both into
 * `space`, resolve missing/powerless components (an achromatic endpoint's
 * hue becomes the OTHER endpoint's hue), premultiply non-hue channels by
 * alpha, lerp, then un-premultiply. `hueMethod` controls which way a
 * hue-bearing space (`hsl`, `oklch`) rotates; ignored otherwise.
 */
export function interpolateColor(
  a: CssColor,
  b: CssColor,
  t: number,
  space: InterpolationSpace,
  hueMethod: HueInterpolationMethod = 'shorter',
): CssColor {
  const ca = toSpaceComponents(a, space)
  const cb = toSpaceComponents(b, space)
  const alphaA = cssColorAlpha(a)
  const alphaB = cssColorAlpha(b)
  const alpha = lerp(alphaA, alphaB, t)

  // Missing (null) non-hue channels take the OTHER endpoint's resolved value
  // (CSS Color 4 §12.2) — interpolation along that channel is then a no-op,
  // which is exactly "carry the other stop's value forward".
  const channels = ca.channels.map((va, i) => {
    const vb = cb.channels[i] ?? null
    const resolvedA = va ?? vb ?? 0
    const resolvedB = vb ?? va ?? 0
    const pa = resolvedA * alphaA
    const pb = resolvedB * alphaB
    const p = lerp(pa, pb, t)
    return alpha > 1e-9 ? p / alpha : lerp(resolvedA, resolvedB, t)
  })

  let hue = 0
  if (ca.hue !== null || cb.hue !== null) {
    // A `none`/powerless hue takes the other endpoint's hue; if both are
    // missing, the hue is irrelevant (chroma/saturation is 0 throughout).
    const hueA = ca.achromatic || ca.hue === null ? (cb.hue ?? 0) : ca.hue
    const hueB = cb.achromatic || cb.hue === null ? (ca.hue ?? 0) : cb.hue
    const [h1, h2] = adjustHue(hueA, hueB, hueMethod)
    hue = lerp(h1, h2, t)
  }

  return fromSpaceComponents(space, channels, hue, clamp01(alpha))
}
