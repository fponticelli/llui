/**
 * Shared color math — conversions, CSS Color 4 parsing/serialization, sRGB
 * gamut mapping, and interpolation. Pure, allocation-light, no DOM.
 *
 * `color-picker.ts` is the first consumer; `gradient-picker.ts` is the
 * second — this module exists so both read from ONE implementation of the
 * OKLCH math and the CSS Color 4 rules instead of drifting like every
 * per-component copy in this package used to (see `utils/number.ts`'s header
 * for the shape of that failure mode).
 *
 * ## Conventions
 *
 * - `Hsl`/`Hsv`: `h` in degrees 0–360, `s`/`l`/`v` in 0–100 — FLOATS, not
 *   rounded. Every conversion in this module (`rgb255ToHsl`, `hslToHsv`,
 *   `hsvToHsl`, `hsvToRgb255`, `rgb255ToHsv`, `hsvToSrgb`, `srgbToHsv`,
 *   `hslToSrgb`, `srgbToHsl`) is a lossless float round trip; rounding
 *   happens ONLY at the byte boundary (`srgbToRgb255`) or when FORMATTING
 *   for display (`formatHex`, a slider's displayed value, `aria-valuetext`).
 *   A component storing an integer-rounded intermediate is a correctness
 *   bug, not a style choice — `#123457` round-tripped through a rounding
 *   HSV store used to come back `#123659` (measured).
 * - `Rgb255`: 0–255, integers after rounding.
 * - `Srgb`: 0–1 floats — the sRGB gamma-encoded value (what `#rrggbb` and
 *   `rgb()` describe).
 * - `Oklab`/`Oklch`: Björn Ottosson's OKLab, `L` 0–1, `h` in degrees. OKLCH
 *   values are NOT clamped to sRGB — `oklch(0.9 0.3 150)` is a valid CSS
 *   color outside sRGB, and only the sRGB/hex conversions gamut-map it.
 * - `Lab`/`Lch`: CIE Lab (D50-relative, per CSS Color 4), `L` 0–100.
 * - `Hwb`: `h` in degrees, `w`/`bk` (whiteness/blackness) 0–100.
 * - Any wide-gamut CSS Color 4 syntax (`lab()`, `lch()`, `color()` with a
 *   predefined space other than `srgb`/`srgb-linear`) is represented, once
 *   parsed, as `{ space: 'oklch', ... }` — OKLCH is already this module's
 *   exact, unbounded-chroma representation, so there is no need for `CssColor`
 *   to grow a separate tag per source syntax. `color(srgb ...)` and
 *   `color(srgb-linear ...)` become `{ space: 'srgb', ... }` directly.
 *
 * ## `none` components
 *
 * CSS Color 4 lets any component be the keyword `none`. Every component of
 * {@link CssColor} is therefore `number | null`, `null` standing for `none`.
 * Two rules apply everywhere a `null` reaches arithmetic:
 * 1. Outside interpolation, a missing component behaves as 0 (`resolveNone`).
 * 2. Inside {@link interpolateColor}, a missing component — hue or otherwise
 *    — takes the OTHER endpoint's value for that component (CSS Color 4
 *    §12.2), which is what makes an achromatic stop take the other stop's
 *    hue — but ONLY when the hue is actually missing (`none`, or produced as
 *    such by a cross-space conversion of a genuinely achromatic color).
 *    `oklch(1 0 90)` has an EXPLICIT hue of 90, not a missing one, and
 *    interpolates as a real 90 rather than being replaced by the other
 *    stop's hue — verified against real Chromium (a rendered
 *    `linear-gradient(in oklch, oklch(1 0 90), oklch(0.6 0.2 200))`, pixels
 *    read back and converted to OKLCH); see `test/utils/color.test.ts`'s
 *    "powerless vs explicit hue" describe block for the exact numbers and
 *    the repro. Only a CROSS-space conversion of an achromatic color (e.g.
 *    projecting `white` into `hsl` for an `in hsl` interpolation) produces a
 *    hue that did not exist before the conversion, and THAT is null.
 */

// ── Basic types ─────────────────────────────────────────────────────────────

/** HSL color. `h` 0–360 degrees, `s`/`l` 0–100. Float — see the module doc. */
export interface Hsl {
  h: number
  s: number
  l: number
}

/** HSV color. `h` 0–360 degrees, `s`/`v` 0–100. Float — see the module doc. */
export interface Hsv {
  h: number
  s: number
  v: number
}

/** HWB color. `h` 0–360 degrees, `w` (whiteness)/`bk` (blackness) 0–100. */
export interface Hwb {
  h: number
  w: number
  bk: number
}

/** CIE Lab, D50-relative (CSS Color 4 `lab()`). `l` 0–100; `a`/`b` unbounded
 * (CSS's reference range is ±125, but the value itself is not clamped). */
export interface Lab {
  l: number
  a: number
  b: number
}

/** CIE LCh, the polar form of {@link Lab}. `l` 0–100, `c` >= 0, `h` degrees. */
export interface Lch {
  l: number
  c: number
  h: number
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

/** CIE XYZ tristimulus values, relative to whichever white point the
 * function producing them documents (D65 unless named otherwise). */
export interface Xyz {
  x: number
  y: number
  z: number
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

// ── 3x3 matrix helper ────────────────────────────────────────────────────────

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

function mulMat3(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

// ── HSL / HSV / RGB — LOSSLESS float conversions ────────────────────────────
//
// Every function here works in floats end to end. Rounding happens only at
// `srgbToRgb255` (the byte boundary) — never inside a conversion. HSV<->HSL
// and HSV/HSL<->sRGB are exact bijections of the same RGB cylinder; the only
// historical precision loss in this module was `Math.round` calls INSIDE
// these functions, which compounded across a `hex -> hsv -> hex` round trip.

function hslToSrgbFloat(hsl: Hsl): Srgb {
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
  return { r: r + m, g: g + m, b: b + m }
}

function srgbToHslFloat(s: Srgb): Hsl {
  const max = Math.max(s.r, s.g, s.b)
  const min = Math.min(s.r, s.g, s.b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === s.r) h = ((s.g - s.b) / d) % 6
    else if (max === s.g) h = (s.b - s.r) / d + 2
    else h = (s.r - s.g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s: sat * 100, l: l * 100 }
}

function hsvToSrgbFloat(hsv: Hsv): Srgb {
  const h = normalizeHueDeg(hsv.h)
  const s = hsv.s / 100
  const v = hsv.v / 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r: number
  let g: number
  let b: number
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: r + m, g: g + m, b: b + m }
}

function srgbToHsvFloat(s: Srgb): Hsv {
  const max = Math.max(s.r, s.g, s.b)
  const min = Math.min(s.r, s.g, s.b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === s.r) h = ((s.g - s.b) / d) % 6
    else if (max === s.g) h = (s.b - s.r) / d + 2
    else h = (s.r - s.g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const v = max
  const sat = max === 0 ? 0 : d / max
  return { h, s: sat * 100, v: v * 100 }
}

/** HSL -> sRGB, float, lossless. */
export function hslToSrgb(hsl: Hsl): Srgb {
  return hslToSrgbFloat(hsl)
}

/** sRGB -> HSL, float, lossless (no byte quantization). */
export function srgbToHsl(s: Srgb): Hsl {
  return srgbToHslFloat(s)
}

/** HSV -> sRGB, DIRECT (not routed through HSL), float, lossless. */
export function hsvToSrgb(hsv: Hsv): Srgb {
  return hsvToSrgbFloat(hsv)
}

/** sRGB -> HSV, DIRECT (not routed through HSL), float, lossless. */
export function srgbToHsv(s: Srgb): Hsv {
  return srgbToHsvFloat(s)
}

/** Convert HSL (h 0-360, s/l 0-100) to RGB (0-255 each, rounded). */
export function hslToRgb255(hsl: Hsl): Rgb255 {
  return srgbToRgb255(hslToSrgbFloat(hsl))
}

/** Convert RGB (0-255 each) to HSL (h 0-360, s/l 0-100), float. */
export function rgb255ToHsl(rgb: Rgb255): Hsl {
  return srgbToHslFloat(srgb255ToSrgb(rgb))
}

/** Convert HSL (h 0-360, s/l 0-100) to HSV (h 0-360, s/v 0-100), float. */
export function hslToHsv(hsl: Hsl): Hsv {
  const l = hsl.l / 100
  const sl = hsl.s / 100
  const v = l + sl * Math.min(l, 1 - l)
  const s = v === 0 ? 0 : 2 * (1 - l / v)
  return { h: hsl.h, s: s * 100, v: v * 100 }
}

/** Convert HSV (h 0-360, s/v 0-100) to HSL (h 0-360, s/l 0-100), float. */
export function hsvToHsl(hsv: Hsv): Hsl {
  const v = hsv.v / 100
  const sv = hsv.s / 100
  const l = v * (1 - sv / 2)
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
  return { h: hsv.h, s: s * 100, l: l * 100 }
}

/** HSV -> RGB255, via the DIRECT (not HSL-routed) float conversion. */
export function hsvToRgb255(hsv: Hsv): Rgb255 {
  return srgbToRgb255(hsvToSrgbFloat(hsv))
}

/** RGB255 -> HSV, via the DIRECT (not HSL-routed) float conversion. */
export function rgb255ToHsv(rgb: Rgb255): Hsv {
  return srgbToHsvFloat(srgb255ToSrgb(rgb))
}

// ── HWB ──────────────────────────────────────────────────────────────────────

/** HWB -> sRGB (CSS Color 4 §8.4). */
export function hwbToSrgb(hwb: Hwb): Srgb {
  const w = hwb.w / 100
  const bk = hwb.bk / 100
  if (w + bk >= 1) {
    const gray = w / (w + bk)
    return { r: gray, g: gray, b: gray }
  }
  const rgb = hslToSrgbFloat({ h: hwb.h, s: 100, l: 50 })
  const scale = 1 - w - bk
  return {
    r: rgb.r * scale + w,
    g: rgb.g * scale + w,
    b: rgb.b * scale + w,
  }
}

/** sRGB -> HWB. */
export function srgbToHwb(s: Srgb): Hwb {
  const { h } = srgbToHsvFloat(s)
  const max = Math.max(s.r, s.g, s.b)
  const min = Math.min(s.r, s.g, s.b)
  return { h, w: min * 100, bk: (1 - max) * 100 }
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

// ── Composite HSV <-> OKLCH (through sRGB, direct float path) ───────────────

export function hsvToOklch(hsv: Hsv): Oklch {
  return srgbToOklch(hsvToSrgbFloat(hsv))
}

/** Gamut-maps into sRGB first — HSV cannot represent an out-of-gamut color. */
export function oklchToHsv(ok: Oklch): Hsv {
  return srgbToHsvFloat(gamutMapOklchToSrgb(ok))
}

// ── CIE XYZ (D65) <-> linear sRGB, and the Bradford D50<->D65 bridge ────────
//
// These are the bridge every non-sRGB `color()` predefined space and every
// `lab()`/`lch()` color crosses to reach OKLab. Matrices are transcribed from
// the CSS Color 4 spec's own sample conversion code (the constants Björn
// Ottosson/Lindbloom publish and every serious implementation reproduces).
// IMPORTANT — verification honesty: this sandbox has no network access and no
// reference color library (colorjs.io, culori, …) installed, so these
// matrices could NOT be cross-checked against an independent numeric oracle
// while writing this file. `test/utils/color.test.ts` instead pins: (1) the
// D65/D50 white-point round trips (physical constants, not derived from these
// matrices), (2) forward∘inverse identity for every matrix pair, and (3) a
// handful of values that don't depend on the wide-gamut matrices at all
// (`color(srgb ...)`, `color(srgb-linear ...)`). A transcription error in one
// of the wide-gamut matrices (display-p3/a98-rgb/prophoto-rgb/rec2020) is the
// most likely residual risk in this file — flag it to whoever can run this
// against a real reference implementation.

const LINEAR_SRGB_TO_XYZ_D65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
]
const XYZ_D65_TO_LINEAR_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
]

const BRADFORD_D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
]
const BRADFORD_D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
]

function xyzD65ToLinearSrgb(xyz: Xyz): Srgb {
  const [r, g, b] = mulMat3(XYZ_D65_TO_LINEAR_SRGB, [xyz.x, xyz.y, xyz.z])
  return { r, g, b }
}

function xyzD65ToOklab(xyz: Xyz): Oklab {
  return linearSrgbToOklab(xyzD65ToLinearSrgb(xyz))
}

function xyzD50ToD65(xyz: Xyz): Xyz {
  const [x, y, z] = mulMat3(BRADFORD_D50_TO_D65, [xyz.x, xyz.y, xyz.z])
  return { x, y, z }
}

/** XYZ (D65) -> XYZ (D50), Bradford chromatic adaptation. The inverse of
 * {@link xyzD50ToD65} — not on this module's own parse/serialize path (every
 * D50-native input, `lab()`/`lch()`/`color(xyz-d50 ...)`, converts TO D65 to
 * reach OKLab), but exported as the natural symmetric counterpart for a
 * caller that needs to go the other way (e.g. producing a `lab()`/`lch()`
 * string from an OKLCH color). */
export function xyzD65ToD50(xyz: Xyz): Xyz {
  const [x, y, z] = mulMat3(BRADFORD_D65_TO_D50, [xyz.x, xyz.y, xyz.z])
  return { x, y, z }
}

// ── CIE Lab / LCh (D50), per CSS Color 4 §9 ─────────────────────────────────

/** D50 white point, computed the way the CSS Color 4 spec derives it
 * (`xy` chromaticity (0.3457, 0.3585) -> XYZ), matching the spec's own
 * sample code rather than a separately-rounded literal. */
const D50_WHITE: Xyz = { x: 0.3457 / 0.3585, y: 1, z: (1 - 0.3457 - 0.3585) / 0.3585 }

const LAB_KAPPA = 24389 / 27
const LAB_EPSILON = 216 / 24389

function labF(t: number): number {
  return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116
}

function labFInverse(t: number): number {
  const t3 = t * t * t
  return t3 > LAB_EPSILON ? t3 : (116 * t - 16) / LAB_KAPPA
}

/** Lab (D50) -> XYZ (D50). */
export function labToXyzD50(lab: Lab): Xyz {
  const fy = (lab.l + 16) / 116
  const fx = fy + lab.a / 500
  const fz = fy - lab.b / 200
  return {
    x: D50_WHITE.x * labFInverse(fx),
    y: D50_WHITE.y * labFInverse(fy),
    z: D50_WHITE.z * labFInverse(fz),
  }
}

/** XYZ (D50) -> Lab (D50). */
export function xyzD50ToLab(xyz: Xyz): Lab {
  const fx = labF(xyz.x / D50_WHITE.x)
  const fy = labF(xyz.y / D50_WHITE.y)
  const fz = labF(xyz.z / D50_WHITE.z)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export function labToLch(lab: Lab): Lch {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
  const h = normalizeHueDeg((Math.atan2(lab.b, lab.a) * 180) / Math.PI)
  return { l: lab.l, c, h }
}

export function lchToLab(lch: Lch): Lab {
  const hRad = (lch.h * Math.PI) / 180
  return { l: lch.l, a: lch.c * Math.cos(hRad), b: lch.c * Math.sin(hRad) }
}

function labToOklch(lab: Lab): Oklch {
  return oklabToOklch(xyzD65ToOklab(xyzD50ToD65(labToXyzD50(lab))))
}

// ── `color()` predefined RGB spaces ──────────────────────────────────────────

export type PredefinedRgbSpace =
  | 'srgb'
  | 'srgb-linear'
  | 'display-p3'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020'

interface PredefinedRgbSpaceInfo {
  toXyz: Mat3
  nativeWhite: 'd65' | 'd50'
  toLinear: (encoded: number) => number
}

function powGamma(gamma: number): (c: number) => number {
  return (c: number): number => Math.sign(c) * Math.abs(c) ** gamma
}

const A98_GAMMA = 563 / 256

function prophotoToLinear(c: number): number {
  const abs = Math.abs(c)
  const Et2 = 16 / 512
  return abs < Et2 ? c / 16 : Math.sign(c) * abs ** 1.8
}

const REC2020_ALPHA = 1.09929682680944
const REC2020_BETA = 0.018053968510807

function rec2020ToLinear(c: number): number {
  const abs = Math.abs(c)
  return abs < REC2020_BETA * 4.5
    ? c / 4.5
    : Math.sign(c) * ((abs + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45)
}

const PREDEFINED_RGB_SPACES: Record<Exclude<PredefinedRgbSpace, 'srgb'>, PredefinedRgbSpaceInfo> = {
  'srgb-linear': { toXyz: LINEAR_SRGB_TO_XYZ_D65, nativeWhite: 'd65', toLinear: (c) => c },
  'display-p3': {
    toXyz: [
      [0.4865709486482162, 0.26566769316909306, 0.19821728523436247],
      [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
      [0.0, 0.04511338185890264, 1.043944368900976],
    ],
    nativeWhite: 'd65',
    toLinear: srgbChannelToLinear,
  },
  'a98-rgb': {
    toXyz: [
      [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
      [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
      [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
    ],
    nativeWhite: 'd65',
    toLinear: powGamma(A98_GAMMA),
  },
  'prophoto-rgb': {
    toXyz: [
      [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
      [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
      [0.0, 0.0, 0.8251046025104601],
    ],
    nativeWhite: 'd50',
    toLinear: prophotoToLinear,
  },
  rec2020: {
    toXyz: [
      [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
      [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
      [0.0, 0.028072693049087428, 1.060985057710791],
    ],
    nativeWhite: 'd65',
    toLinear: rec2020ToLinear,
  },
}

/** Any `color()` predefined RGB space -> OKLCH, exact (no gamut mapping). */
function predefinedRgbToOklch(space: PredefinedRgbSpace, r: number, g: number, b: number): Oklch {
  if (space === 'srgb') return srgbToOklch({ r, g, b })
  const info = PREDEFINED_RGB_SPACES[space]
  const lin: [number, number, number] = [info.toLinear(r), info.toLinear(g), info.toLinear(b)]
  const [x, y, z] = mulMat3(info.toXyz, lin)
  const xyz: Xyz = info.nativeWhite === 'd50' ? xyzD50ToD65({ x, y, z }) : { x, y, z }
  return oklabToOklch(xyzD65ToOklab(xyz))
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
 * straight to {@link srgbToRgb255}. `test/utils/color.test.ts` pins the
 * converged chroma for a known out-of-gamut color as a regression value
 * (this file's own binary search, not an independent oracle — see that
 * test's comment for what it does and does not prove).
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

/** A color as CSS Color 4 sees it. `lab()`/`lch()`/wide-gamut `color()` are
 * NOT separate tags here — see the module doc — they resolve to `'oklch'` (or
 * `'srgb'` for `color(srgb ...)`/`color(srgb-linear ...)`) at parse time. */
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
      return hslToSrgbFloat({ h: resolveNone(c.h), s: resolveNone(c.s), l: resolveNone(c.l) })
    case 'oklab':
      return oklabToSrgb({ l: resolveNone(c.l), a: resolveNone(c.a), b: resolveNone(c.b) })
    case 'oklch':
      return oklchToSrgb({ l: resolveNone(c.l), c: resolveNone(c.c), h: resolveNone(c.h) })
  }
}

/** Resolved alpha (`none` -> 1, CSS Color 4's used value for a missing
 * alpha OUTSIDE interpolation). Inside {@link interpolateColor}, a missing
 * alpha instead carries the OTHER endpoint's alpha — see its doc comment. */
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

/** `oklab(L A B)` / `oklab(L A B / A)`, same precision convention as
 * {@link formatOklch} — `gradient-picker`'s `colorAt` needs this to stay
 * exact when the interpolation space itself is `oklab` (interpolating in
 * `oklch` and in `oklab` are different color spaces, and only one of them has
 * a serializer here otherwise). */
export function formatOklab(lab: Oklab, alpha = 1): string {
  const l = lab.l.toFixed(4)
  const a = lab.a.toFixed(4)
  const b = lab.b.toFixed(4)
  return alpha >= 1 ? `oklab(${l} ${a} ${b})` : `oklab(${l} ${a} ${b} / ${round(alpha, 4)})`
}

/** `hsl(H S% L%)` / `hsl(H S% L% / A)`. `gradient-picker`'s `colorAt` needs
 * this so an `in hsl` interpolation result can be serialized without an extra
 * (lossy) round trip through sRGB bytes. */
export function formatHsl(hsl: Hsl, alpha = 1): string {
  const h = round(normalizeHueDeg(hsl.h), 2)
  const s = round(hsl.s, 2)
  const l = round(hsl.l, 2)
  return alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${round(alpha, 4)})`
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** CSS `<number>` production: optional sign, digits (with an optional
 * fraction), optional exponent. Deliberately stricter than JS's `Number()`,
 * which also accepts hex (`0x10`), `Infinity`, `NaN`, and `''` — all invalid
 * CSS numbers that `Number()` would silently let through. */
const CSS_NUMBER_RE = /^[+-]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)(?:e[+-]?\d+)?$/i

function parseCssNumber(token: string): number | null {
  if (!CSS_NUMBER_RE.test(token)) return null
  const n = Number(token)
  return Number.isFinite(n) ? n : null
}

interface ParsedComponent {
  value: number | null
}

/** `none`, a bare `<number>`, or a `<percentage>` scaled onto
 * `[0, percentScale]`. */
function parseComponent(token: string, percentScale: number): ParsedComponent | null {
  if (token === 'none') return { value: null }
  if (token.endsWith('%')) {
    const n = parseCssNumber(token.slice(0, -1))
    return n === null ? null : { value: (n / 100) * percentScale }
  }
  const n = parseCssNumber(token)
  return n === null ? null : { value: n }
}

/** A hue component: bare `<number>` (degrees), `<number>deg|grad|rad|turn`,
 * or `none`. */
function parseHueComponent(token: string): ParsedComponent | null {
  if (token === 'none') return { value: null }
  const m = /^([+-]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(token)
  if (!m) return null
  const n = parseCssNumber(m[1]!)
  if (n === null) return null
  const unit = m[2]?.toLowerCase()
  if (unit === 'grad') return { value: n * 0.9 }
  if (unit === 'rad') return { value: (n * 180) / Math.PI }
  if (unit === 'turn') return { value: n * 360 }
  return { value: n }
}

/** Whether every one of `tokens` is a percentage (`%`-suffixed). Used to
 * enforce the LEGACY `rgb()`/`rgba()` grammar's uniform-type rule
 * (`rgb(<percentage>#{3})` or `rgb(<number>#{3})`, never mixed) — the modern
 * space-separated syntax has no such restriction. */
function allPercent(tokens: readonly string[]): boolean {
  return tokens.every((t) => t.endsWith('%'))
}
function nonePercent(tokens: readonly string[]): boolean {
  return tokens.every((t) => t !== 'none' && !t.endsWith('%'))
}

interface SplitResult {
  comps: string[]
  alpha: string | null
  /** Legacy = comma-separated color args. The modern space-separated syntax
   * and the legacy comma syntax have DIFFERENT grammars (`none` and mixed
   * number/percentage args are modern-only; slash-alpha is modern-only) —
   * every caller must branch on this, not just tolerate both spellings. */
  legacy: boolean
}

/** Split a CSS color function's argument list into its component tokens and
 * an optional alpha token, per CSS Color 4's two mutually exclusive
 * grammars. Returns `null` for a combination the grammar does not allow:
 * slash-alpha mixed into the legacy comma form, or a comma form with a
 * component-count other than 3 (before an optional trailing alpha) or 4. */
function splitComponents(body: string): SplitResult | null {
  const slashIdx = body.lastIndexOf('/')
  let main = body
  let alphaToken: string | null = null
  if (slashIdx !== -1) {
    main = body.slice(0, slashIdx)
    alphaToken = body.slice(slashIdx + 1).trim()
  }
  const hasComma = main.includes(',')
  if (hasComma) {
    // Legacy comma syntax has no slash-alpha spelling at all.
    if (alphaToken !== null) return null
    const comps = main
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    if (comps.length === 4) {
      alphaToken = comps.pop() ?? null
    } else if (comps.length !== 3) {
      return null
    }
    return { comps, alpha: alphaToken, legacy: true }
  }
  const comps = main
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return { comps, alpha: alphaToken, legacy: false }
}

function parseAlpha(token: string | null, legacy: boolean): ParsedComponent | null {
  if (token === null) return { value: 1 }
  // `none` is a modern-syntax-only keyword; a legacy comma form naming it
  // (`rgba(255, 0, 0, none)`) is invalid, not "alpha 0".
  if (legacy && token === 'none') return null
  return parseComponent(token, 1)
}

function parseRgbFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.comps.length !== 3) return null
  const { comps, alpha, legacy } = split
  // Legacy grammar: `none` anywhere is invalid, and the three color args
  // must be uniformly percentages or uniformly numbers.
  if (legacy && (comps.some((t) => t === 'none') || !(allPercent(comps) || nonePercent(comps)))) {
    return null
  }
  const r = parseComponent(comps[0]!, 255)
  const g = parseComponent(comps[1]!, 255)
  const b = parseComponent(comps[2]!, 255)
  const a = parseAlpha(alpha, legacy)
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
  const split = splitComponents(body)
  if (!split || split.comps.length !== 3) return null
  const { comps, alpha, legacy } = split
  if (legacy && comps.some((t) => t === 'none')) return null
  const h = parseHueComponent(comps[0]!)
  const s = parseComponent(comps[1]!, 100)
  const l = parseComponent(comps[2]!, 100)
  const a = parseAlpha(alpha, legacy)
  if (!h || !s || !l || !a) return null
  return { space: 'hsl', h: h.value, s: s.value, l: l.value, alpha: a.value }
}

/** `hwb()` has no legacy comma form at all — CSS Color 4 introduced it
 * space-separated only. */
function parseHwbFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.legacy || split.comps.length !== 3) return null
  const h = parseHueComponent(split.comps[0]!)
  const w = parseComponent(split.comps[1]!, 100)
  const bk = parseComponent(split.comps[2]!, 100)
  const a = parseAlpha(split.alpha, false)
  if (!h || !w || !bk || !a) return null
  const srgb = hwbToSrgb({
    h: resolveNone(h.value),
    w: resolveNone(w.value),
    bk: resolveNone(bk.value),
  })
  return { space: 'srgb', r: srgb.r, g: srgb.g, b: srgb.b, alpha: a.value }
}

function parseOklchFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.legacy || split.comps.length !== 3) return null
  const l = parseComponent(split.comps[0]!, 1)
  const c = parseComponent(split.comps[1]!, 0.4)
  const h = parseHueComponent(split.comps[2]!)
  const a = parseAlpha(split.alpha, false)
  if (!l || !c || !h || !a) return null
  return { space: 'oklch', l: l.value, c: c.value, h: h.value, alpha: a.value }
}

function parseOklabFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.legacy || split.comps.length !== 3) return null
  const l = parseComponent(split.comps[0]!, 1)
  const a1 = parseComponent(split.comps[1]!, 0.4)
  const b1 = parseComponent(split.comps[2]!, 0.4)
  const a = parseAlpha(split.alpha, false)
  if (!l || !a1 || !b1 || !a) return null
  return { space: 'oklab', l: l.value, a: a1.value, b: b1.value, alpha: a.value }
}

/** `lab()` — L 0-100 (or 0%-100%), a/b unbounded (reference range ±125 ==
 * ±100%). No legacy comma form. Resolves to `'oklch'` — see the module doc. */
function parseLabFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.legacy || split.comps.length !== 3) return null
  const l = parseComponent(split.comps[0]!, 100)
  const a1 = parseComponent(split.comps[1]!, 125)
  const b1 = parseComponent(split.comps[2]!, 125)
  const a = parseAlpha(split.alpha, false)
  if (!l || !a1 || !b1 || !a) return null
  const ok = labToOklch({
    l: resolveNone(l.value),
    a: resolveNone(a1.value),
    b: resolveNone(b1.value),
  })
  return { space: 'oklch', l: ok.l, c: ok.c, h: ok.h, alpha: a.value }
}

/** `lch()` — L 0-100, C >= 0 (100% == 150), H degrees. No legacy comma form.
 * Resolves to `'oklch'`. */
function parseLchFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.legacy || split.comps.length !== 3) return null
  const l = parseComponent(split.comps[0]!, 100)
  const c = parseComponent(split.comps[1]!, 150)
  const h = parseHueComponent(split.comps[2]!)
  const a = parseAlpha(split.alpha, false)
  if (!l || !c || !h || !a) return null
  const ok = labToOklch(
    lchToLab({ l: resolveNone(l.value), c: resolveNone(c.value), h: resolveNone(h.value) }),
  )
  return { space: 'oklch', l: ok.l, c: ok.c, h: ok.h, alpha: a.value }
}

const PREDEFINED_SPACE_NAMES: ReadonlySet<string> = new Set([
  'srgb',
  'srgb-linear',
  'display-p3',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz',
  'xyz-d50',
  'xyz-d65',
])

/** `color(<space> c1 c2 c3 [/ alpha])`. No legacy comma form. `xyz` is an
 * alias for `xyz-d65`. RGB predefined spaces resolve to `'srgb'` (native) or
 * `'oklch'` (wide-gamut — never squashed into a bounded representation); the
 * two XYZ spaces always resolve to `'oklch'`. */
function parseColorFunction(body: string): CssColor | null {
  const split = splitComponents(body)
  if (!split || split.legacy || split.comps.length !== 4) return null
  const spaceName = split.comps[0]!
  if (!PREDEFINED_SPACE_NAMES.has(spaceName)) return null
  const a = parseAlpha(split.alpha, false)
  if (!a) return null

  if (spaceName === 'xyz' || spaceName === 'xyz-d50' || spaceName === 'xyz-d65') {
    const x = parseComponent(split.comps[1]!, 1)
    const y = parseComponent(split.comps[2]!, 1)
    const z = parseComponent(split.comps[3]!, 1)
    if (!x || !y || !z) return null
    let xyz: Xyz = { x: resolveNone(x.value), y: resolveNone(y.value), z: resolveNone(z.value) }
    if (spaceName === 'xyz-d50') xyz = xyzD50ToD65(xyz)
    const ok = oklabToOklch(xyzD65ToOklab(xyz))
    return { space: 'oklch', l: ok.l, c: ok.c, h: ok.h, alpha: a.value }
  }

  const space = spaceName as PredefinedRgbSpace
  const c1 = parseComponent(split.comps[1]!, 1)
  const c2 = parseComponent(split.comps[2]!, 1)
  const c3 = parseComponent(split.comps[3]!, 1)
  if (!c1 || !c2 || !c3) return null
  const r = resolveNone(c1.value)
  const g = resolveNone(c2.value)
  const b = resolveNone(c3.value)
  if (space === 'srgb') return { space: 'srgb', r, g, b, alpha: a.value }
  if (space === 'srgb-linear') {
    const srgb = linearToSrgb({ r, g, b })
    return { space: 'srgb', r: srgb.r, g: srgb.g, b: srgb.b, alpha: a.value }
  }
  const ok = predefinedRgbToOklch(space, r, g, b)
  return { space: 'oklch', l: ok.l, c: ok.c, h: ok.h, alpha: a.value }
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
 * `#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()` (both legacy comma
 * and modern space/slash syntax, with the legacy grammar's `none`-forbidden
 * and uniform-percentage-or-number rules enforced), `hwb()`, `oklch()`,
 * `oklab()`, `lab()`, `lch()`, `color()` (predefined spaces `srgb`,
 * `srgb-linear`, `display-p3`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz`,
 * `xyz-d50`, `xyz-d65`), `none` components, `transparent`, and the 148 CSS
 * Color 4 named colors. Returns `null` on anything else — never throws.
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
    case 'hwb':
      return parseHwbFunction(body)
    case 'oklch':
      return parseOklchFunction(body)
    case 'oklab':
      return parseOklabFunction(body)
    case 'lab':
      return parseLabFunction(body)
    case 'lch':
      return parseLchFunction(body)
    case 'color':
      return parseColorFunction(body)
    default:
      return null
  }
}

// ── Interpolation (CSS Color 4 §12) ─────────────────────────────────────────

export type HueInterpolationMethod = 'shorter' | 'longer' | 'increasing' | 'decreasing'

/**
 * Adjust `h2` relative to `h1` per the hue interpolation method, returning
 * `[h1, h2]` such that a plain `lerp` between them (then normalizing mod 360)
 * gives the correct path. BOTH inputs are normalized to [0,360) FIRST — CSS
 * Color 4 §12.4 requires this ("hue values ... must be constrained to fall
 * within the range [0, 360) prior to interpolation"): an unnormalized
 * `increasing` from 10 to 400 must behave exactly like 10 to 40 (midpoint
 * 25), not lerp(10, 400) (midpoint 205) — pinned in `test/utils/color.test.ts`.
 */
function adjustHue(h1raw: number, h2raw: number, method: HueInterpolationMethod): [number, number] {
  const h1 = normalizeHueDeg(h1raw)
  let h2 = normalizeHueDeg(h2raw)
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
  /** The hue component (degrees), if this space has one. `null` only when
   * the color's OWN space has no hue (never happens for `hsl`/`oklch`
   * themselves — a value copied from that space's own storage is used
   * VERBATIM, explicit or `none`) or when a CROSS-space conversion produced
   * one from a genuinely achromatic color, which has no hue to carry over —
   * see the module doc's "powerless vs explicit hue" note. */
  hue: number | null
}

function toSpaceComponents(c: CssColor, space: InterpolationSpace): SpaceComponents {
  if (c.space === space) {
    switch (c.space) {
      case 'srgb':
      case 'srgb-linear':
        return { channels: [c.r, c.g, c.b], hue: null }
      case 'hsl':
        return { channels: [c.s, c.l], hue: c.h }
      case 'oklab':
        return { channels: [c.l, c.a, c.b], hue: null }
      case 'oklch':
        return { channels: [c.l, c.c], hue: c.h }
    }
  }
  // Cross-space: materialize through the fully-resolved math (a `none`
  // component here has already been treated as 0, which is the CSS Color 4
  // rule for a value used outside the color's OWN space). An achromatic
  // result's hue is genuinely UNDEFINED by this conversion (it did not exist
  // in the source color), so it becomes `null` here — this is NOT the same
  // rule as a same-space color's own explicit hue, which is never nulled by
  // this function.
  switch (space) {
    case 'srgb': {
      const s = cssColorToSrgb(c)
      return { channels: [s.r, s.g, s.b], hue: null }
    }
    case 'srgb-linear': {
      const s = srgbToLinear(cssColorToSrgb(c))
      return { channels: [s.r, s.g, s.b], hue: null }
    }
    case 'hsl': {
      const hsl = srgbToHslFloat(cssColorToSrgb(c))
      return { channels: [hsl.s, hsl.l], hue: hsl.s === 0 ? null : hsl.h }
    }
    case 'oklab': {
      const lab = srgbToOklab(cssColorToSrgb(c))
      return { channels: [lab.l, lab.a, lab.b], hue: null }
    }
    case 'oklch': {
      const ok = srgbToOklch(cssColorToSrgb(c))
      return { channels: [ok.l, ok.c], hue: ok.c < 1e-6 ? null : ok.h }
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
 * `space`, resolve missing (`none`, or a cross-space-converted achromatic
 * color's undefined) components — including alpha itself, which carries the
 * OTHER endpoint's alpha when missing rather than defaulting to 1 (CSS Color
 * 4 §12.2's analogous-component rule applies to alpha too — `rgb(255 0 0 /
 * none)` mixed with `rgb(0 0 255 / 0.2)` has alpha exactly 0.2 throughout,
 * not a lerp toward 1; pinned in `test/utils/color.test.ts`) —
 * premultiply non-hue channels by alpha, lerp, then un-premultiply.
 * `hueMethod` controls which way a hue-bearing space (`hsl`, `oklch`)
 * rotates, normalizing both hues to [0,360) FIRST (see {@link adjustHue});
 * ignored for spaces with no hue.
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

  // Missing alpha carries the OTHER endpoint's own alpha (CSS Color 4
  // §12.2's analogous-component rule applies to alpha too, not just the
  // space's own channels) — resolved PER SIDE, so premultiplication below
  // uses the same substituted values the result alpha is computed from.
  const rawAlphaA = a.alpha
  const rawAlphaB = b.alpha
  const alphaA = rawAlphaA ?? rawAlphaB ?? 1
  const alphaB = rawAlphaB ?? rawAlphaA ?? 1
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
    // A missing hue (this color's own space explicitly `none`, or a
    // cross-space conversion of a genuinely achromatic color) takes the
    // OTHER endpoint's hue; if both are missing, the hue is irrelevant
    // (chroma/saturation is 0 throughout).
    const hueA = ca.hue ?? cb.hue ?? 0
    const hueB = cb.hue ?? ca.hue ?? 0
    const [h1, h2] = adjustHue(hueA, hueB, hueMethod)
    hue = lerp(h1, h2, t)
  }

  return fromSpaceComponents(space, channels, hue, clamp01(alpha))
}
