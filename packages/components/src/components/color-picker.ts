import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { colorPickerLocale } from '../locale/color-picker.js'
import {
  allFiniteNumbers,
  clamp,
  finiteOrDefault,
  positiveFiniteOrDefault,
} from '../utils/number.js'
import { onScopeTeardown } from '../utils/lifecycle.js'
import { pointerDragHandlers } from '../utils/pointer-drag.js'
import type { Hsl, Hsv, Oklch, Srgb, CssColor } from '../utils/color.js'
import {
  hslToHsv,
  hsvToHsl,
  hsvToRgb255,
  rgb255ToHsv,
  srgb255ToSrgb,
  srgbToRgb255,
  hsvToOklch,
  oklchToHsv,
  gamutMapOklchToSrgb,
  inSrgbGamut,
  formatHex,
  formatHex8,
  formatOklch,
  parseCssColor,
  cssColorToSrgb,
  cssColorAlpha,
  resolveNone,
} from '../utils/color.js'

/**
 * Color picker — HSV and OKLCH color selection.
 *
 * The canonical color lives in whichever model is ACTIVE (`state.color.model`)
 * and is lossless within that model. Every message that edits the color goes
 * through a PROJECTION into the model it naturally operates in (HSV, HSL, or
 * OKLCH), applies the edit there, then converts the result into the active
 * model — so `setSaturation` (an HSL concept) and `setChroma` (an OKLCH
 * concept) both work regardless of which model is currently active, and
 * `setHue` sets the hue of whichever model IS active (HSV hue and OKLCH hue
 * are numerically different rulers for the same wheel).
 *
 * HUE STABILITY ON ACHROMATIC COLORS is the reason HSV was chosen as the
 * original canonical store (S or V at 0 loses no information about hue,
 * unlike HSL's black/white axis) and it is preserved across the HSV<->OKLCH
 * boundary too: {@link hsvToOklchPreserving}/{@link oklchToHsvPreserving}
 * carry the stored hue straight across whenever the color is achromatic in
 * the SOURCE model, rather than recomputing an arbitrary hue-of-zero-chroma.
 * `setModel` and every cross-model projection route through these two.
 */

export type ColorModel = 'hsv' | 'oklch'

export type { Hsl, Hsv, Oklch }

/** `0.37` covers the whole of sRGB and most of Display P3 while leaving the
 * 2D area / chroma slider a sensible fixed range (an unbounded chroma axis
 * has no natural "full scale" to show) — the default for
 * {@link ColorPickerState.maxChroma} when `init()` gets no `maxChroma`
 * option. */
export const DEFAULT_MAX_CHROMA = 0.37

export interface ColorPickerState {
  color:
    | { model: 'hsv'; h: number; s: number; v: number }
    | { model: 'oklch'; l: number; c: number; h: number }
  /** Alpha channel 0..1. */
  alpha: number
  disabled: boolean
  /** Upper bound for OKLCH chroma — the ONE source of truth for the reducer's
   * clamp (`setOklch`/`setChroma`/`setLc`/`nudgeLc`) AND for `connect()`'s
   * chroma slider/area rendering range, so the two can no longer disagree
   * the way a `ConnectOptions.maxChroma` rendering-only override could.
   * Always finite and > 0 (`init` validates it; there is no setter — it is
   * fixed for the component's lifetime, like `slider`'s `min`/`max`). */
  maxChroma: number
}

export type ColorPickerMsg =
  /** @intent("Switch the active color model, converting the stored color and keeping its hue stable if it is achromatic") */
  | { type: 'setModel'; model: ColorModel }
  /** @intent("Set the full HSL color at once") */
  | { type: 'setHsl'; hsl: Hsl }
  /** @intent("Set the hue of the ACTIVE model (0–360)") */
  | { type: 'setHue'; h: number }
  /** @intent("Set the HSL saturation channel (0–100)") */
  | { type: 'setSaturation'; s: number }
  /** @intent("Set the HSL lightness channel (0–100)") */
  | { type: 'setLightness'; l: number }
  /** @intent("Set the alpha channel (0–1)") */
  | { type: 'setAlpha'; alpha: number }
  /** @intent("Set the color from any CSS color string (hex, rgb(), hsl(), oklch(), oklab(), a named color)") */
  | { type: 'setHex'; hex: string }
  /** @intent("Set saturation and value (HSV, 0–100 each) from the 2D area") */
  | { type: 'setSv'; s: number; v: number }
  /** @intent("Nudge saturation/value (HSV) by signed deltas — used by area arrow keys") */
  | { type: 'nudgeSv'; ds: number; dv: number }
  /** @intent("Set the color from a swatch, an eyedropper pick, or any CSS color string") */
  | { type: 'setColor'; color: string }
  /** @intent("Set the full OKLCH color at once (L 0–1, C >= 0, H degrees)") */
  | { type: 'setOklch'; l: number; c: number; h: number }
  /** @intent("Set the OKLCH chroma channel") */
  | { type: 'setChroma'; c: number }
  /** @intent("Set the OKLCH lightness channel (0–1)") */
  | { type: 'setOklchLightness'; l: number }
  /** @intent("Set chroma and lightness (OKLCH, x/y of the 2D area) at once") */
  | { type: 'setLc'; c: number; l: number }
  /** @intent("Nudge chroma/lightness (OKLCH) by signed deltas — used by area arrow keys") */
  | { type: 'nudgeLc'; dc: number; dl: number }

export interface ColorPickerInit {
  /** Which model the canonical color is stored in. Default `'hsv'`. */
  model?: ColorModel
  /** Initial color as any CSS color string the shared parser accepts (hex,
   * `rgb()`, `hsl()`, `oklch()`, `oklab()`, a named color). Takes precedence
   * over `hsl`/`hsv`/`oklch` below, and over `alpha` for the color's own
   * alpha component (an explicit `alpha` option still wins). */
  color?: string
  /** Initial color as HSL (converted into the canonical store). */
  hsl?: Hsl
  /** Initial color as HSV. Takes precedence over `hsl`. */
  hsv?: Hsv
  /** Initial color as OKLCH. Takes precedence over `hsl`/`hsv`. */
  oklch?: Oklch
  alpha?: number
  disabled?: boolean
  /** Upper bound for OKLCH chroma. Must be finite and > 0 — anything else
   * (including omission) falls back to {@link DEFAULT_MAX_CHROMA}. */
  maxChroma?: number
}

const DEFAULT_HSV: Hsv = { h: 0, s: 100, v: 100 }
const ACHROMATIC_CHROMA_EPSILON = 1e-6

function isAchromaticHsv(hsv: Hsv): boolean {
  return hsv.s === 0 || hsv.v === 0
}

function isAchromaticOklch(ok: Oklch): boolean {
  return ok.c <= ACHROMATIC_CHROMA_EPSILON
}

function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360
}

/** Exported for `gradient-picker`, which sanitizes a stop's color the same
 * way `init`/`setColor` do when projecting a parsed CSS color onto HSV. */
export function sanitizeHsv(raw: Hsv): Hsv {
  return {
    h: finiteOrDefault(raw.h, 0),
    s: finiteOrDefault(raw.s, 100),
    v: finiteOrDefault(raw.v, 100),
  }
}

/** Exported for `gradient-picker`, same reason as {@link sanitizeHsv}. */
export function sanitizeOklch(raw: Oklch, maxChroma: number): Oklch {
  return {
    l: clamp(finiteOrDefault(raw.l, 1), 0, 1),
    c: clamp(finiteOrDefault(raw.c, 0), 0, maxChroma),
    h: normalizeHue(finiteOrDefault(raw.h, 0)),
  }
}

/** HSV -> OKLCH, keeping the HSV hue verbatim when the color is achromatic
 * (S or V is 0) instead of the arbitrary hue an achromatic OKLab conversion
 * would otherwise produce. */
export function hsvToOklchPreserving(hsv: Hsv): Oklch {
  const ok = hsvToOklch(hsv)
  return isAchromaticHsv(hsv) ? { ...ok, h: normalizeHue(hsv.h) } : ok
}

/** OKLCH -> HSV (gamut-mapped), keeping the OKLCH hue verbatim when the
 * color is achromatic (chroma ~0). */
export function oklchToHsvPreserving(ok: Oklch): Hsv {
  const hsv = oklchToHsv(ok)
  return isAchromaticOklch(ok) ? { ...hsv, h: normalizeHue(ok.h) } : hsv
}

/** The canonical stored color union — HSV or OKLCH, tagged by `model`.
 * Exported as a named type for `gradient-picker`, whose stops each store one
 * of these (never a hex string) so a gray stop keeps its hue and an
 * out-of-gamut OKLCH stop stays exact. */
export type PickerColor = ColorPickerState['color']
type Color = PickerColor

function colorToHsv(color: Color): Hsv {
  return color.model === 'hsv'
    ? { h: color.h, s: color.s, v: color.v }
    : oklchToHsvPreserving(color)
}

function colorToOklch(color: Color): Oklch {
  return color.model === 'oklch'
    ? { l: color.l, c: color.c, h: color.h }
    : hsvToOklchPreserving(color)
}

/** Apply an edit expressed in HSV terms, in either model. */
function withHsvProjection(color: Color, f: (hsv: Hsv) => Hsv): Color {
  const next = sanitizeHsv(f(colorToHsv(color)))
  return color.model === 'hsv'
    ? { model: 'hsv', ...next }
    : { model: 'oklch', ...hsvToOklchPreserving(next) }
}

/** Apply an edit expressed in HSL terms (the S/L sliders), in either model.
 * Distinct from {@link withHsvProjection}: the classic 3-slider layout edits
 * HSL saturation/lightness, while the 2D area edits HSV saturation/value —
 * two different projections of the same HSV store, preserved from the
 * pre-OKLCH component. */
function withHslProjection(color: Color, f: (hsl: Hsl) => Hsl): Color {
  return withHsvProjection(color, (hsv) => hslToHsv(f(hsvToHsl(hsv))))
}

/** Apply an edit expressed in OKLCH terms, in either model. */
function withOklchProjection(color: Color, maxChroma: number, f: (ok: Oklch) => Oklch): Color {
  const next = sanitizeOklch(f(colorToOklch(color)), maxChroma)
  return color.model === 'oklch'
    ? { model: 'oklch', ...next }
    : { model: 'hsv', ...oklchToHsvPreserving(next) }
}

/**
 * Project an already-PARSED CssColor onto BOTH canonical models at once. The
 * shared core of {@link colorFromCssString} (string input, via
 * `parseCssColor`) and {@link cssColorToPickerColor} (an already-typed input
 * that never touched a string — `gradient-picker`'s `colorAt` produces one
 * straight from {@link interpolateColor}, and round-tripping THAT through a
 * formatted string before storing it would be the exact hex-round-trip loss
 * this module exists to avoid on a gray stop).
 */
function pickerProjectionsOfCssColor(
  parsed: CssColor,
  maxChroma: number,
): { hsv: Hsv; oklch: Oklch; alpha: number } {
  const alpha = cssColorAlpha(parsed)
  if (parsed.space === 'oklch') {
    const oklch = sanitizeOklch(
      {
        l: resolveNone(parsed.l),
        c: resolveNone(parsed.c),
        h: resolveNone(parsed.h),
      },
      maxChroma,
    )
    return { oklch, hsv: oklchToHsvPreserving(oklch), alpha }
  }
  if (parsed.space === 'oklab') {
    const lab = { l: resolveNone(parsed.l), a: resolveNone(parsed.a), b: resolveNone(parsed.b) }
    const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
    const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
    const oklch = sanitizeOklch({ l: lab.l, c, h }, maxChroma)
    return { oklch, hsv: oklchToHsvPreserving(oklch), alpha }
  }
  const srgb = cssColorToSrgb(parsed)
  const hsv = sanitizeHsv(rgb255ToHsv(srgbToRgb255(srgb)))
  return { hsv, oklch: sanitizeOklch(hsvToOklchPreserving(hsv), maxChroma), alpha }
}

function colorFromCssString(
  input: string,
  maxChroma: number,
): { hsv: Hsv; oklch: Oklch; alpha: number } | null {
  const parsed = parseCssColor(input)
  return parsed ? pickerProjectionsOfCssColor(parsed, maxChroma) : null
}

/**
 * Convert an already-parsed {@link CssColor} into the canonical store for a
 * given active `model`, exactly the way `setColor`/`setHex` project a typed
 * color string — but for a caller (`gradient-picker`) that already has a
 * `CssColor`, never a string, and must not round-trip through one.
 */
export function cssColorToPickerColor(
  parsed: CssColor,
  model: ColorModel,
  maxChroma: number,
): { color: PickerColor; alpha: number } {
  const { hsv, oklch, alpha } = pickerProjectionsOfCssColor(parsed, maxChroma)
  return {
    color: model === 'oklch' ? { model: 'oklch', ...oklch } : { model: 'hsv', ...hsv },
    alpha,
  }
}

/**
 * The inverse of {@link cssColorToPickerColor}: a canonical stored color plus
 * alpha, as the shared {@link CssColor} model `interpolateColor` operates on.
 * OKLCH stays OKLCH (exact, not gamut-mapped); HSV becomes `srgb`.
 */
export function pickerColorToCssColor(color: PickerColor, alpha: number): CssColor {
  if (color.model === 'oklch') {
    return { space: 'oklch', l: color.l, c: color.c, h: color.h, alpha }
  }
  const srgb = srgb255ToSrgb(hsvToRgb255(color))
  return { space: 'srgb', r: srgb.r, g: srgb.g, b: srgb.b, alpha }
}

export function init(opts: ColorPickerInit = {}): ColorPickerState {
  const model: ColorModel = opts.model ?? 'hsv'
  const disabled = opts.disabled ?? false
  const maxChroma = positiveFiniteOrDefault(opts.maxChroma, DEFAULT_MAX_CHROMA)

  let hsv = DEFAULT_HSV
  let oklch = sanitizeOklch(hsvToOklchPreserving(DEFAULT_HSV), maxChroma)
  let parsedAlpha: number | undefined

  const fromString = opts.color !== undefined ? colorFromCssString(opts.color, maxChroma) : null
  if (fromString) {
    hsv = fromString.hsv
    oklch = fromString.oklch
    parsedAlpha = fromString.alpha
  } else if (opts.oklch !== undefined) {
    oklch = sanitizeOklch(opts.oklch, maxChroma)
    hsv = oklchToHsvPreserving(oklch)
  } else if (opts.hsv !== undefined) {
    hsv = sanitizeHsv(opts.hsv)
    oklch = sanitizeOklch(hsvToOklchPreserving(hsv), maxChroma)
  } else if (opts.hsl !== undefined) {
    hsv = sanitizeHsv(hslToHsv(opts.hsl))
    oklch = sanitizeOklch(hsvToOklchPreserving(hsv), maxChroma)
  }

  const alpha = finiteOrDefault(opts.alpha, parsedAlpha ?? 1)

  return {
    color: model === 'oklch' ? { model: 'oklch', ...oklch } : { model: 'hsv', ...hsv },
    alpha,
    disabled,
    maxChroma,
  }
}

/** Project the current color onto HSV (gamut-mapped if the active model is
 * OKLCH and out of gamut). */
export function stateHsv(state: ColorPickerState): Hsv {
  return colorToHsv(state.color)
}

/** Project the current color onto HSL (via {@link stateHsv}). */
export function stateHsl(state: ColorPickerState): Hsl {
  return hsvToHsl(stateHsv(state))
}

/** Project the current color onto OKLCH (exact — not gamut-mapped — if the
 * active model already IS OKLCH; derived from HSV otherwise, which is
 * always in-gamut by construction). */
export function stateOklch(state: ColorPickerState): Oklch {
  return colorToOklch(state.color)
}

/** The current color as displayable (gamut-mapped) sRGB, 0-1 per channel. */
function stateSrgb(state: ColorPickerState): Srgb {
  return state.color.model === 'hsv'
    ? srgb255ToSrgb(hsvToRgb255(state.color))
    : gamutMapOklchToSrgb(state.color)
}

/** Whether the OKLCH color falls outside the sRGB gamut (always `false` in
 * HSV mode — an HSV color is an sRGB parameterization by construction). */
export function isOutOfGamut(state: ColorPickerState): boolean {
  return state.color.model === 'oklch' ? !inSrgbGamut(state.color) : false
}

/** `#rrggbb`, gamut-mapped from OKLCH when the active model needs it. */
export function toHex(state: ColorPickerState): string {
  return formatHex(srgbToRgb255(stateSrgb(state)))
}

/** `#rrggbbaa`. */
export function toHex8(state: ColorPickerState): string {
  return formatHex8(srgbToRgb255(stateSrgb(state)), state.alpha)
}

/**
 * The current color as a CSS string. HSV model -> hex (`#rrggbb`/`#rrggbbaa`
 * depending on alpha) — cheap, familiar, and what the hex input already
 * shows. OKLCH model -> `oklch()`, EXACT rather than gamut-mapped, because
 * an OKLCH color may legitimately sit outside sRGB and a hex round trip
 * would silently clip it; the browser gamut-maps `oklch()` for display on
 * its own terms, same as it would for a value typed directly into CSS.
 */
export function toCss(state: ColorPickerState): string {
  if (state.color.model === 'oklch') return formatOklch(state.color, state.alpha)
  return state.alpha < 1 ? toHex8(state) : toHex(state)
}

/**
 * Map a pointer position over the 2D saturation/value area to HSV S/V (0..100).
 * X axis is saturation (left 0 → right 100); Y axis is value (top 100 → bottom 0).
 * The point is clamped to the rect, so out-of-bounds drags saturate cleanly.
 */
export function colorFromPoint(rect: DOMRect, x: number, y: number): { s: number; v: number } {
  const sx = rect.width === 0 ? 0 : clamp((x - rect.left) / rect.width, 0, 1)
  const sy = rect.height === 0 ? 0 : clamp((y - rect.top) / rect.height, 0, 1)
  return { s: Math.round(sx * 100), v: Math.round((1 - sy) * 100) }
}

/**
 * Map a pointer position over the 2D chroma/lightness area to OKLCH C/L.
 * X axis is chroma (left 0 → right `maxChroma`); Y axis is lightness
 * (top 1 → bottom 0), mirroring {@link colorFromPoint}'s value axis.
 */
export function lcFromPoint(
  rect: DOMRect,
  x: number,
  y: number,
  maxChroma: number = DEFAULT_MAX_CHROMA,
): { c: number; l: number } {
  const sx = rect.width === 0 ? 0 : clamp((x - rect.left) / rect.width, 0, 1)
  const sy = rect.height === 0 ? 0 : clamp((y - rect.top) / rect.height, 0, 1)
  return { c: sx * maxChroma, l: 1 - sy }
}

export function update(state: ColorPickerState, msg: ColorPickerMsg): [ColorPickerState, never[]] {
  if (
    (msg.type === 'setHsl' && !allFiniteNumbers(msg.hsl)) ||
    (msg.type === 'setHue' && !allFiniteNumbers(msg.h)) ||
    (msg.type === 'nudgeSv' && !allFiniteNumbers(msg.ds, msg.dv)) ||
    (msg.type === 'setOklch' && !allFiniteNumbers(msg.l, msg.c, msg.h)) ||
    (msg.type === 'setChroma' && !allFiniteNumbers(msg.c)) ||
    (msg.type === 'setOklchLightness' && !allFiniteNumbers(msg.l)) ||
    (msg.type === 'setLc' && !allFiniteNumbers(msg.c, msg.l)) ||
    (msg.type === 'nudgeLc' && !allFiniteNumbers(msg.dc, msg.dl))
  ) {
    return [state, []]
  }
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setModel': {
      if (msg.model === state.color.model) return [state, []]
      const color: Color =
        state.color.model === 'hsv'
          ? { model: 'oklch', ...sanitizeOklch(hsvToOklchPreserving(state.color), state.maxChroma) }
          : { model: 'hsv', ...oklchToHsvPreserving(state.color) }
      return [{ ...state, color }, []]
    }
    case 'setHsl':
      return [{ ...state, color: withHsvProjection(state.color, () => hslToHsv(msg.hsl)) }, []]
    case 'setHue':
      return [{ ...state, color: { ...state.color, h: normalizeHue(msg.h) } }, []]
    case 'setSaturation':
      return [
        {
          ...state,
          color: withHslProjection(state.color, (hsl) => ({ ...hsl, s: clamp(msg.s, 0, 100) })),
        },
        [],
      ]
    case 'setLightness':
      return [
        {
          ...state,
          color: withHslProjection(state.color, (hsl) => ({ ...hsl, l: clamp(msg.l, 0, 100) })),
        },
        [],
      ]
    case 'setAlpha':
      return [{ ...state, alpha: clamp(msg.alpha, 0, 1) }, []]
    case 'setHex':
    case 'setColor': {
      const input = msg.type === 'setHex' ? msg.hex : msg.color
      const parsed = colorFromCssString(input, state.maxChroma)
      if (!parsed) return [state, []]
      const color: Color =
        state.color.model === 'oklch'
          ? { model: 'oklch', ...parsed.oklch }
          : { model: 'hsv', ...parsed.hsv }
      return [{ ...state, color, alpha: parsed.alpha }, []]
    }
    case 'setSv':
      return [
        {
          ...state,
          color: withHsvProjection(state.color, (hsv) => ({
            ...hsv,
            s: clamp(msg.s, 0, 100),
            v: clamp(msg.v, 0, 100),
          })),
        },
        [],
      ]
    case 'nudgeSv':
      return [
        {
          ...state,
          color: withHsvProjection(state.color, (hsv) => ({
            ...hsv,
            s: clamp(hsv.s + msg.ds, 0, 100),
            v: clamp(hsv.v + msg.dv, 0, 100),
          })),
        },
        [],
      ]
    case 'setOklch':
      return [
        {
          ...state,
          color: withOklchProjection(state.color, state.maxChroma, () => ({
            l: msg.l,
            c: msg.c,
            h: msg.h,
          })),
        },
        [],
      ]
    case 'setChroma':
      return [
        {
          ...state,
          color: withOklchProjection(state.color, state.maxChroma, (ok) => ({ ...ok, c: msg.c })),
        },
        [],
      ]
    case 'setOklchLightness':
      return [
        {
          ...state,
          color: withOklchProjection(state.color, state.maxChroma, (ok) => ({ ...ok, l: msg.l })),
        },
        [],
      ]
    case 'setLc':
      return [
        {
          ...state,
          color: withOklchProjection(state.color, state.maxChroma, (ok) => ({
            ...ok,
            c: msg.c,
            l: msg.l,
          })),
        },
        [],
      ]
    case 'nudgeLc':
      return [
        {
          ...state,
          color: withOklchProjection(state.color, state.maxChroma, (ok) => ({
            ...ok,
            c: ok.c + msg.dc,
            l: ok.l + msg.dl,
          })),
        },
        [],
      ]
  }
}

// ── Eyedropper (EyeDropper API) ─────────────────────────────────────────────

export interface EyeDropperOpenOptions {
  signal?: AbortSignal
}
export interface EyeDropperResult {
  sRGBHex: string
}
interface EyeDropperInstance {
  open(options?: EyeDropperOpenOptions): Promise<EyeDropperResult>
}
interface EyeDropperConstructor {
  new (): EyeDropperInstance
}
declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor
  }
}

/**
 * Whether the EyeDropper API is available. SSR-safe (`false` when there is
 * no `window`) and STATIC — a plain function, not a `Signal`, so `connect()`
 * never has to decide between two answers for the SAME render: the part bag
 * it publishes is identical on the server and on the client's first paint
 * (`eyeDropperTrigger` is always rendered enabled/visible from the machine's
 * point of view). A consumer that wants to hide or disable the button on an
 * unsupported browser calls this from its own `onMount` and sets the DOM
 * attribute directly — the same pattern `theme-switch.ts`'s `resolveTheme`
 * uses for `prefers-color-scheme`, and the only point in this package where
 * a browser-only capability decides what renders.
 */
export function supportsEyeDropper(): boolean {
  return typeof window !== 'undefined' && window.EyeDropper !== undefined
}

/**
 * Open the browser's native EyeDropper UI and resolve to the picked color as
 * `#rrggbb`. Resolves `null` — never rejects — when the API is unsupported
 * or the user cancels (`AbortError`, including a deliberate
 * `signal.abort()`). Rejects only for a genuine unexpected failure.
 */
export async function openEyeDropper(signal?: AbortSignal): Promise<string | null> {
  if (typeof window === 'undefined' || window.EyeDropper === undefined) return null
  try {
    const result = await new window.EyeDropper().open(signal ? { signal } : undefined)
    return result.sRGBHex
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
}

// ── OKLCH plane rendering (the 2D area's canvas, in OKLCH mode) ─────────────

/**
 * Render one OKLCH hue's chroma/lightness plane as RGBA pixels — chroma
 * increasing left to right (0..`maxChroma`), lightness increasing bottom to
 * top (0..1), matching {@link lcFromPoint}'s axes. Out-of-gamut pixels are
 * fully transparent (alpha 0) rather than gamut-mapped, so a consumer can
 * paint them hatched/checkered underneath if it wants a visible "no color
 * here" cue instead of a silently-wrong one.
 *
 * O(width * height) OKLCH->sRGB conversions, each potentially running the
 * gamut-mapping binary search — keep the canvas modest (a few hundred
 * pixels per side) and repaint only on hue change, not on every pointer move.
 */
export function oklchPlanePixels(
  hue: number,
  width: number,
  height: number,
  maxChroma: number = DEFAULT_MAX_CHROMA,
): Uint8ClampedArray<ArrayBuffer> {
  const length = Math.max(0, width) * Math.max(0, height) * 4
  const out = new Uint8ClampedArray(new ArrayBuffer(length))
  if (width <= 0 || height <= 0) return out
  for (let y = 0; y < height; y++) {
    const l = height === 1 ? 1 : 1 - y / (height - 1)
    for (let x = 0; x < width; x++) {
      const c = width === 1 ? 0 : (x / (width - 1)) * maxChroma
      const ok: Oklch = { l, c, h: hue }
      const gamutOk = inSrgbGamut(ok)
      const rgb = srgbToRgb255(gamutOk ? gamutMapOklchToSrgb(ok) : gamutMapOklchToSrgb(ok))
      const idx = (y * width + x) * 4
      out[idx] = rgb.r
      out[idx + 1] = rgb.g
      out[idx + 2] = rgb.b
      out[idx + 3] = gamutOk ? 255 : 0
    }
  }
  return out
}

/** Paint {@link oklchPlanePixels} onto a canvas sized to its current
 * `width`/`height`. A no-op on a zero-sized canvas or a context-less
 * environment (jsdom without a 2D context polyfill). */
export function paintOklchPlane(
  canvas: HTMLCanvasElement,
  hue: number,
  maxChroma: number = DEFAULT_MAX_CHROMA,
): void {
  const { width, height } = canvas
  if (width <= 0 || height <= 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pixels = oklchPlanePixels(hue, width, height, maxChroma)
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
}

/** A full-circle OKLCH hue ramp at a fixed lightness/chroma, using CSS
 * Color 4's `in oklch longer hue` interpolation method — the ONLY way to
 * express a hue sweep as a plain gradient, since hue 0 and hue 360 are the
 * SAME point in `oklab`/`srgb` (the default interpolation space), so a
 * naive `linear-gradient(oklch(L C 0), oklch(L C 360))` would render as a
 * solid color instead of a rainbow. */
export function oklchHueRampGradient(l = 0.75, c = 0.15): string {
  return `linear-gradient(in oklch longer hue, oklch(${l} ${c} 0), oklch(${l} ${c} 360))`
}

// ── Part bag ─────────────────────────────────────────────────────────────────

export interface ColorPickerParts {
  root: {
    'data-scope': 'color-picker'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
    'data-model': Signal<ColorModel>
    /** Bare boolean (package convention): present when the current OKLCH
     * color falls outside sRGB. Always absent in HSV mode (an HSV color is
     * an sRGB parameterization by construction). */
    'data-out-of-gamut': Signal<'' | undefined>
  }
  /** Cycles the active model between `'hsv'` and `'oklch'`. */
  modelToggle: {
    type: 'button'
    'aria-label': Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'model-toggle'
    'data-model': Signal<ColorModel>
    onClick: (e: MouseEvent) => void
  }
  hueSlider: {
    type: 'range'
    min: 0
    max: 360
    step: 1
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'hue-slider'
    onInput: (e: Event) => void
  }
  saturationSlider: {
    type: 'range'
    min: 0
    max: 100
    step: 1
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'saturation-slider'
    onInput: (e: Event) => void
  }
  lightnessSlider: {
    type: 'range'
    min: 0
    max: 100
    step: 1
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'lightness-slider'
    onInput: (e: Event) => void
  }
  /** OKLCH chroma, `0..state.maxChroma`. */
  chromaSlider: {
    type: 'range'
    min: 0
    max: Signal<number>
    step: Signal<number>
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'chroma-slider'
    onInput: (e: Event) => void
  }
  /** OKLCH perceptual lightness, `0..1`. */
  oklchLightnessSlider: {
    type: 'range'
    min: 0
    max: 1
    step: number
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'oklch-lightness-slider'
    onInput: (e: Event) => void
  }
  hexInput: {
    type: 'text'
    autocomplete: 'off'
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'hex-input'
    onInput: (e: Event) => void
  }
  /** Static preview swatch showing the currently-selected color. */
  preview: {
    'data-scope': 'color-picker'
    'data-part': 'preview'
    'aria-hidden': 'true'
    style: Signal<string>
  }
  /** The 2D area track. The machine owns the pointer-drag lifecycle
   * (capture on down, released on up/cancel, primary button only, ignored
   * while disabled): it computes from `currentTarget.getBoundingClientRect()`
   * and dispatches `setSv` (HSV mode, via `colorFromPoint`) or `setLc`
   * (OKLCH mode, via `lcFromPoint`) — see `utils/pointer-drag.ts`. Keyboard
   * continues from wherever a drag left off because `pointerdown` focuses
   * `areaThumb`. */
  area: {
    'data-scope': 'color-picker'
    'data-part': 'area'
    'data-model': Signal<ColorModel>
    // HSV-mode hue backdrop only; empty in OKLCH mode, where `areaCanvas`
    // paints the plane instead (the sRGB gamut boundary is not expressible
    // as a CSS gradient).
    style: Signal<string>
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
  }
  /** Decorative `<canvas>` seam for the OKLCH area — headless, so the
   * consumer owns creating and sizing the real `<canvas>` element and
   * repainting it with {@link paintOklchPlane} on hue change (and on mount).
   * Absent/inert in HSV mode. */
  areaCanvas: {
    'data-scope': 'color-picker'
    'data-part': 'area-canvas'
    'aria-hidden': 'true'
  }
  /** The draggable thumb inside the 2D area. Keyboard-operable (arrows move
   * S/V or C/L depending on the active model; Shift = coarse) with
   * role="slider" and a 2D aria-valuetext. */
  areaThumb: {
    role: 'slider'
    'aria-label': string
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number>
    'aria-valuetext': Signal<string>
    'aria-disabled': Signal<'true' | undefined>
    tabindex: Signal<number>
    'data-scope': 'color-picker'
    'data-part': 'area-thumb'
    style: Signal<string>
    onKeyDown: (e: KeyboardEvent) => void
  }
  /** Alpha (opacity) range input, 0..1. Wired to the existing alpha state. */
  alphaSlider: {
    type: 'range'
    min: 0
    max: 1
    step: number
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'alpha-slider'
    onInput: (e: Event) => void
  }
  /** EyeDropper API trigger. Always published; `supportsEyeDropper()` (a
   * plain, SSR-safe function, not a `Signal` — see its doc comment) is how a
   * consumer decides whether to show or disable it. */
  eyeDropperTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'color-picker'
    'data-part': 'eyedropper-trigger'
    onClick: (e: MouseEvent) => void
  }
  /** Container for the preset swatch buttons. */
  swatchGroup: {
    role: 'group'
    'aria-label': string
    'data-scope': 'color-picker'
    'data-part': 'swatch-group'
  }
  /** Factory for a preset swatch button dispatching a single `setColor`. */
  swatch: (color: string) => SwatchParts
}

export interface SwatchParts {
  type: 'button'
  'aria-label': string
  'aria-pressed': Signal<boolean>
  'data-scope': 'color-picker'
  'data-part': 'swatch'
  'data-value': string
  'data-state': Signal<'selected' | undefined>
  style: string
  onClick: (e: MouseEvent) => void
}

export interface ConnectOptions {
  hueLabel?: string
  saturationLabel?: string
  lightnessLabel?: string
  chromaLabel?: string
  oklchLightnessLabel?: string
  hexLabel?: string
  eyeDropperLabel?: string
  /** aria-label for the 2D area thumb. */
  areaLabel?: string
  /** aria-label for the alpha slider. */
  alphaLabel?: string
  /** aria-label for the swatch group container. */
  swatchGroupLabel?: string
  /** Fine keyboard step for the area thumb (S/V units, or the OKLCH
   * equivalent scaled by `state.maxChroma`). Default 1. */
  step?: number
  /** Coarse keyboard step for the area thumb when Shift is held. Default 10. */
  coarseStep?: number
}

export function connect(
  state: Signal<ColorPickerState>,
  send: Send<ColorPickerMsg>,
  opts: ConnectOptions = {},
): ColorPickerParts {
  const locale = colorPickerLocale()
  const fine = opts.step ?? 1
  const coarse = opts.coarseStep ?? 10

  let pendingEyeDropper: AbortController | null = null
  onScopeTeardown(() => {
    pendingEyeDropper?.abort()
    pendingEyeDropper = null
  })

  // 2D area drag: the machine owns the pointer lifecycle (see
  // `utils/pointer-drag.ts`'s doc comment for why this differs from
  // `slider.ts`/`angle-slider.ts`, which push it onto the consumer).
  const areaDrag = pointerDragHandlers({
    isDisabled: () => state.peek().disabled,
    onDragStart: (e) => {
      ;(e.currentTarget as HTMLElement)
        .querySelector<HTMLElement>('[data-part="area-thumb"]')
        ?.focus()
    },
    onDrag: (e) => {
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      const current = state.peek()
      if (current.color.model === 'oklch') {
        const { c, l } = lcFromPoint(rect, e.clientX, e.clientY, current.maxChroma)
        send({ type: 'setLc', c, l })
      } else {
        const { s, v } = colorFromPoint(rect, e.clientX, e.clientY)
        send({ type: 'setSv', s, v })
      }
    },
  })

  return {
    root: {
      'data-scope': 'color-picker',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-model': state.map((s) => s.color.model),
      'data-out-of-gamut': state.map((s) => (isOutOfGamut(s) ? '' : undefined)),
    },
    modelToggle: {
      type: 'button',
      'aria-label': state.map((s) =>
        s.color.model === 'hsv' ? locale.switchToOklch : locale.switchToHsv,
      ),
      'data-scope': 'color-picker',
      'data-part': 'model-toggle',
      'data-model': state.map((s) => s.color.model),
      onClick: tagSend(send, ['setModel'], () => {
        send({ type: 'setModel', model: state.peek().color.model === 'hsv' ? 'oklch' : 'hsv' })
      }),
    },
    hueSlider: {
      type: 'range',
      min: 0,
      max: 360,
      step: 1,
      'aria-label': opts.hueLabel ?? locale.hue,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(Math.round(s.color.h))),
      'data-scope': 'color-picker',
      'data-part': 'hue-slider',
      onInput: tagSend(send, ['setHue'], (e) =>
        send({ type: 'setHue', h: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    saturationSlider: {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': opts.saturationLabel ?? locale.saturation,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(stateHsl(s).s)),
      style: state.map((s) => {
        const { h, l } = stateHsl(s)
        return `background: linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`
      }),
      'data-scope': 'color-picker',
      'data-part': 'saturation-slider',
      onInput: tagSend(send, ['setSaturation'], (e) =>
        send({ type: 'setSaturation', s: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    lightnessSlider: {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': opts.lightnessLabel ?? locale.lightness,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(stateHsl(s).l)),
      style: state.map((s) => {
        const { h, s: sat } = stateHsl(s)
        return `background: linear-gradient(to right, hsl(${h} ${sat}% 0%), hsl(${h} ${sat}% 50%), hsl(${h} ${sat}% 100%))`
      }),
      'data-scope': 'color-picker',
      'data-part': 'lightness-slider',
      onInput: tagSend(send, ['setLightness'], (e) =>
        send({ type: 'setLightness', l: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    chromaSlider: {
      type: 'range',
      min: 0,
      max: state.map((s) => s.maxChroma),
      step: state.map((s) => s.maxChroma / 200),
      'aria-label': opts.chromaLabel ?? locale.chroma,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(stateOklch(s).c)),
      style: state.map((s) => {
        const ok = stateOklch(s)
        return `background: linear-gradient(to right, ${formatOklch({ l: ok.l, c: 0, h: ok.h })}, ${formatOklch(
          { l: ok.l, c: s.maxChroma, h: ok.h },
        )})`
      }),
      'data-scope': 'color-picker',
      'data-part': 'chroma-slider',
      onInput: tagSend(send, ['setChroma'], (e) =>
        send({ type: 'setChroma', c: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    oklchLightnessSlider: {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.005,
      'aria-label': opts.oklchLightnessLabel ?? locale.oklchLightness,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(stateOklch(s).l)),
      style: state.map((s) => {
        const ok = stateOklch(s)
        return `background: linear-gradient(to right, ${formatOklch({ l: 0, c: ok.c, h: ok.h })}, ${formatOklch(
          { l: 1, c: ok.c, h: ok.h },
        )})`
      }),
      'data-scope': 'color-picker',
      'data-part': 'oklch-lightness-slider',
      onInput: tagSend(send, ['setOklchLightness'], (e) =>
        send({ type: 'setOklchLightness', l: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    hexInput: {
      type: 'text',
      autocomplete: 'off',
      'aria-label': opts.hexLabel ?? locale.hex,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => toHex(s)),
      'data-scope': 'color-picker',
      'data-part': 'hex-input',
      onInput: tagSend(send, ['setHex'], (e) =>
        send({ type: 'setHex', hex: (e.target as HTMLInputElement).value }),
      ),
    },
    preview: {
      'data-scope': 'color-picker',
      'data-part': 'preview',
      'aria-hidden': 'true',
      style: state.map((s) => `background-color:${toCss(s)};`),
    },
    area: {
      'data-scope': 'color-picker',
      'data-part': 'area',
      'data-model': state.map((s) => s.color.model),
      // HSV-mode hue backdrop; empty in OKLCH mode (areaCanvas paints it).
      style: state.map((s) =>
        s.color.model === 'hsv' ? `background-color:hsl(${s.color.h} 100% 50%);` : '',
      ),
      onPointerDown: tagSend(send, ['setSv', 'setLc'], areaDrag.onPointerDown),
      onPointerMove: tagSend(send, ['setSv', 'setLc'], areaDrag.onPointerMove),
      onPointerUp: areaDrag.onPointerUp,
      onPointerCancel: areaDrag.onPointerCancel,
    },
    areaCanvas: {
      'data-scope': 'color-picker',
      'data-part': 'area-canvas',
      'aria-hidden': 'true',
    },
    areaThumb: {
      role: 'slider',
      'aria-label': opts.areaLabel ?? `${locale.saturation} / ${locale.value}`,
      'aria-valuemin': state.map(() => 0),
      'aria-valuemax': state.map((s) => (s.color.model === 'oklch' ? s.maxChroma : 100)),
      'aria-valuenow': state.map((s) => (s.color.model === 'oklch' ? s.color.c : s.color.s)),
      'aria-valuetext': state.map((s) =>
        s.color.model === 'oklch'
          ? `${locale.chroma} ${s.color.c.toFixed(2)}, ${locale.oklchLightness} ${Math.round(s.color.l * 100)}%`
          : `${locale.saturation} ${s.color.s}%, ${locale.value} ${s.color.v}%`,
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      tabindex: state.map((s) => (s.disabled ? -1 : 0)),
      'data-scope': 'color-picker',
      'data-part': 'area-thumb',
      style: state.map((s) => {
        if (s.color.model === 'oklch') {
          const xPct = clamp((s.color.c / s.maxChroma) * 100, 0, 100)
          const yPct = clamp((1 - s.color.l) * 100, 0, 100)
          return `left:${xPct}%;top:${yPct}%;`
        }
        return `left:${s.color.s}%;top:${100 - s.color.v}%;`
      }),
      onKeyDown: tagSend(send, ['nudgeSv', 'nudgeLc'], (e) => {
        const stepUnit = e.shiftKey ? coarse : fine
        const current = state.peek()
        const isOklch = current.color.model === 'oklch'
        const nudge = (dx: number, dy: number): void => {
          if (isOklch) {
            send({ type: 'nudgeLc', dc: (dx / 100) * current.maxChroma, dl: dy / 100 })
          } else {
            send({ type: 'nudgeSv', ds: dx, dv: dy })
          }
        }
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault()
            nudge(stepUnit, 0)
            return
          case 'ArrowLeft':
            e.preventDefault()
            nudge(-stepUnit, 0)
            return
          case 'ArrowUp':
            e.preventDefault()
            nudge(0, stepUnit)
            return
          case 'ArrowDown':
            e.preventDefault()
            nudge(0, -stepUnit)
            return
        }
      }),
    },
    alphaSlider: {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      'aria-label': opts.alphaLabel ?? 'Alpha',
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(s.alpha)),
      style: state.map((s) => {
        const hex = toHex(s)
        return `background: linear-gradient(to right, transparent, ${hex})`
      }),
      'data-scope': 'color-picker',
      'data-part': 'alpha-slider',
      onInput: tagSend(send, ['setAlpha'], (e) =>
        send({ type: 'setAlpha', alpha: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    eyeDropperTrigger: {
      type: 'button',
      'aria-label': opts.eyeDropperLabel ?? locale.eyeDropper,
      disabled: state.map((s) => s.disabled),
      'data-scope': 'color-picker',
      'data-part': 'eyedropper-trigger',
      onClick: tagSend(send, ['setColor'], () => {
        if (state.peek().disabled) return
        pendingEyeDropper?.abort()
        const controller = new AbortController()
        pendingEyeDropper = controller
        void openEyeDropper(controller.signal).then((hex) => {
          if (pendingEyeDropper !== controller) return
          pendingEyeDropper = null
          if (hex !== null) send({ type: 'setColor', color: hex })
        })
      }),
    },
    swatchGroup: {
      role: 'group',
      'aria-label': opts.swatchGroupLabel ?? 'Color swatches',
      'data-scope': 'color-picker',
      'data-part': 'swatch-group',
    },
    swatch: (color: string): SwatchParts => {
      const parsedHex = (): string | null => {
        // Only `.hsv` is read below, so the maxChroma passed here never
        // affects the result — any value would do.
        const parsed = colorFromCssString(color, DEFAULT_MAX_CHROMA)
        return parsed ? formatHex(hsvToRgb255(parsed.hsv)) : null
      }
      const selected = (s: ColorPickerState): boolean => {
        const hex = parsedHex()
        return hex !== null && hex === toHex(s)
      }
      return {
        type: 'button',
        'aria-label': color,
        'aria-pressed': state.map(selected),
        'data-scope': 'color-picker',
        'data-part': 'swatch',
        'data-value': color,
        'data-state': state.map((s) => (selected(s) ? 'selected' : undefined)),
        style: `background-color:${color};`,
        onClick: tagSend(send, ['setColor'], () => send({ type: 'setColor', color })),
      }
    },
  }
}

export const colorPicker = {
  init,
  update,
  connect,
  stateHsl,
  stateHsv,
  stateOklch,
  isOutOfGamut,
  toHex,
  toHex8,
  toCss,
  colorFromPoint,
  lcFromPoint,
  hsvToOklchPreserving,
  oklchToHsvPreserving,
  supportsEyeDropper,
  openEyeDropper,
  oklchPlanePixels,
  paintOklchPlane,
  oklchHueRampGradient,
  hslToHsv,
  hsvToHsl,
  DEFAULT_MAX_CHROMA,
  sanitizeHsv,
  sanitizeOklch,
  pickerColorToCssColor,
  cssColorToPickerColor,
}
