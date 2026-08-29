// OKLab/OKLCh <-> sRGB, CSS Color 4 gamut mapping, color-mix(in oklab, …), and
// WCAG 2.x relative luminance / contrast.
//
// This exists so `chip-contrast.test.ts` can MEASURE the value-hued chip scale
// rather than assert it. The claim it checks — "only the hue varies, so every
// category stays legible" — is exactly the kind that reads as obviously true and
// is false in the obvious colour space: at a fixed HSL lightness a yellow is far
// lighter than a blue, so the same pair of `hsl()` values that gives 9.85:1 at
// H=240 gives 4.30:1 at H=60. Nothing but a sweep finds that.
//
// Everything here is deliberately independent of the browser: a computed-style
// probe in a hidden tab reports whatever a frozen transition left behind, and a
// `cssRules` scan that does not descend into `@layer` / `@supports` reports live
// rules as absent. Both have produced confident wrong answers in this repo.

const cbrt = Math.cbrt

export function oklabToLinearSrgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function linearSrgbToOklab([r, g, b]) {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export const oklchToOklab = ([L, C, h]) => {
  const rad = (h * Math.PI) / 180
  return [L, C * Math.cos(rad), C * Math.sin(rad)]
}

const inGamut = ([r, g, b], eps = 1e-6) =>
  r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps

const clip = ([r, g, b]) => [
  Math.min(1, Math.max(0, r)),
  Math.min(1, Math.max(0, g)),
  Math.min(1, Math.max(0, b)),
]

const deltaEOK = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * CSS Color 4 §13.2 gamut mapping: hold OKLab L and h, binary-search chroma
 * until the clipped candidate is within JND (0.02) of the unclipped one.
 * Returns LINEAR sRGB in [0,1].
 */
export function gamutMapOklabToLinearSrgb(oklab) {
  const direct = oklabToLinearSrgb(oklab)
  if (inGamut(direct)) return clip(direct)
  const [L] = oklab
  if (L >= 1) return [1, 1, 1]
  if (L <= 0) return [0, 0, 0]
  const C = Math.hypot(oklab[1], oklab[2])
  const h = Math.atan2(oklab[2], oklab[1])
  let lo = 0
  let hi = C
  const JND = 0.02
  let best = clip(direct)
  while (hi - lo > 1e-5) {
    const mid = (lo + hi) / 2
    const cand = [L, mid * Math.cos(h), mid * Math.sin(h)]
    const rgb = oklabToLinearSrgb(cand)
    if (inGamut(rgb)) {
      best = clip(rgb)
      lo = mid
    } else {
      const clipped = clip(rgb)
      if (deltaEOK(linearSrgbToOklab(clipped), cand) < JND) {
        best = clipped
        return best
      }
      hi = mid
    }
  }
  return best
}

/** `color-mix(in oklab, a pct%, b)` on opaque colours: a plain OKLab lerp. */
export const mixOklab = (a, b, pct) => [
  a[0] * pct + b[0] * (1 - pct),
  a[1] * pct + b[1] * (1 - pct),
  a[2] * pct + b[2] * (1 - pct),
]

/** WCAG 2.x relative luminance from LINEAR sRGB. */
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

export function contrast(linA, linB) {
  const a = luminance(linA)
  const b = luminance(linB)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const encode = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055)
const decode = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4))

/** Round-trip through 8-bit sRGB, the way a display actually shows it. */
export const quantize = (lin) => lin.map((u) => decode(Math.round(encode(u) * 255) / 255))

export const hex = (lin) =>
  '#' +
  lin
    .map((u) =>
      Math.round(encode(u) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/** HSL -> linear sRGB, for comparing the issue's proposed formulation. */
export function hslToLinearSrgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [decode(f(0)), decode(f(8)), decode(f(4))]
}
