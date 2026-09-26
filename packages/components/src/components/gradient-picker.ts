import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { gradientPickerLocale } from '../locale/gradient-picker.js'
import { allFiniteNumbers, clamp, finiteOrDefault, positiveFinite } from '../utils/number.js'
import { pointerDragHandlers } from '../utils/pointer-drag.js'
import { wrapChildSend } from '../utils/child-send.js'
import { flipArrow } from '../utils/direction.js'
import type { CssColor, HueInterpolationMethod, InterpolationSpace } from '../utils/color.js'
import {
  parseCssColor,
  interpolateColor,
  cssColorAlpha,
  resolveNone,
  cssColorToSrgb,
  srgbToRgb255,
  formatHex,
  formatHex8,
  formatOklch,
  formatOklab,
  formatHsl,
} from '../utils/color.js'
import {
  update as colorPickerUpdate,
  connect as colorPickerConnect,
  cssColorToPickerColor,
  pickerColorToCssColor,
  pickerColorToCss,
  DEFAULT_MAX_CHROMA,
} from './color-picker.js'
import type {
  ColorPickerState,
  ColorPickerMsg,
  ColorPickerParts,
  ColorModel,
  PickerColor,
  ConnectOptions as ColorPickerConnectOptions,
} from './color-picker.js'

/**
 * Gradient picker — CSS `linear-gradient()`/`radial-gradient()`/
 * `conic-gradient()` (and their `repeating-` forms) authoring: a horizontal
 * stop ramp plus per-kind controls, with a full `color-picker` embedded for
 * whichever stop is selected.
 *
 * ## The embedded picker edits the SELECTED STOP'S OWN model
 *
 * There is exactly one color store per stop (`GradientStop.color`, the same
 * `PickerColor` union `color-picker` itself uses) and exactly one place that
 * projects it into a live `ColorPickerState`: {@link pickerStateOf}. It hands
 * the stop's color through UNCHANGED — no HSV<->OKLCH re-projection — so a
 * picker message that only touches one channel (`setAlpha`, `setHue`, …)
 * leaves every OTHER channel of an out-of-gamut OKLCH stop bit-identical.
 * `update()`'s `'picker'` case runs `colorPicker.update` on that DERIVED
 * state and writes `color`/`alpha` straight back onto the SELECTED stop; a
 * stop's MODEL only ever changes via an explicit `picker: { msg: { type:
 * 'setModel' } } }`, which is itself just `color-picker`'s own reducer
 * producing a same-shape `next.color` in the new model — there is no
 * separate "gradient-level model" to keep in sync. `defaultModel` is a
 * DIFFERENT, narrower thing: which model a freshly-added stop with no other
 * way to pick one starts in (see `addStop`/`buildStopsFromOptions`).
 *
 * ## The stop-position domain is always one cycle, 0–100
 *
 * `repeating` only changes the CSS `repeating-` prefix (how the SAME 0–100
 * ramp tiles across the painted box) — it never changes what a stop's
 * `position` number means. `colorAt`/`addStop` always read `position` as a
 * percentage of one cycle; `colorAt` WRAPS a query outside `[first, last]`
 * by the stop range's own period when `repeating` is true (matching a real
 * `repeating-linear-gradient`'s paint), and clamps to the end stops
 * otherwise. `toCss`'s stop list is always the one un-repeated cycle,
 * matching what {@link parseGradient} reads back.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type GradientKind = 'linear' | 'radial' | 'conic'
export type RadialShape = 'circle' | 'ellipse'
export type RadialSize = 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner'

export interface GradientCenter {
  x: number
  y: number
}

export interface GradientInterpolation {
  space: InterpolationSpace
  hue: HueInterpolationMethod
}

/**
 * A linear gradient's direction, exactly as CSS Images 4 lets it be spelled:
 * an explicit angle, or `to <side-or-corner>`. Parsing a `to right` gradient
 * and immediately serializing it back must reproduce `to right`, not a
 * numerically-equal `90deg` — only an EXPLICIT angle edit (the `setAngle`
 * message, e.g. from `angleInput` or the angle-slider composition) converts
 * a keyword direction into an angle. `x`/`y` are independently optional so a
 * single-axis direction (`to right`, `to top`) round-trips without a
 * fabricated opposite axis; both set means a corner.
 */
export type GradientDirection =
  | { type: 'angle'; deg: number }
  | { type: 'to'; x?: 'left' | 'right'; y?: 'top' | 'bottom' }

export interface GradientStop {
  id: string
  color: PickerColor
  alpha: number
  /** 0–100, one cycle — see the module doc comment. */
  position: number
}

export interface GradientPickerState {
  kind: GradientKind
  repeating: boolean
  /** Linear only. Ignored (but still stored — the machine always publishes
   * both per-kind clusters; the view branches on `kind`) for radial/conic. */
  direction: GradientDirection
  /** Degrees, conic's `from` angle only. Conic has no `to <side>` form in
   * CSS at all, so — unlike linear — it never needs the `GradientDirection`
   * union; it is always a plain angle. */
  conicAngle: number
  /** Percent 0–100. Radial + conic only. */
  center: GradientCenter
  /** Radial only. */
  shape: RadialShape
  /** Radial only. */
  size: RadialSize
  interpolation: GradientInterpolation
  /** Kept sorted by `position` ascending; ties keep insertion order. */
  stops: GradientStop[]
  selectedId: string
  /** The next deterministic stop id counter (`` `s${nextId}` ``) — the reducer
   * stays pure, so ids can never come from `Math.random()`/`crypto`. MONOTONE
   * across a `setGradient`: a successful replace continues the counter
   * rather than restarting at `s1`, so an id a consumer captured earlier
   * (a DOM id, a test assertion, an undo/redo log) is never reissued to a
   * DIFFERENT stop. */
  nextId: number
  /** Which model a freshly-added stop starts in when nothing else determines
   * one (`buildStopsFromOptions`'s fallback color). Distinct from any
   * EXISTING stop's own stored model, which `picker`/`setModel` edits
   * in-place — see the module doc comment. */
  defaultModel: ColorModel
  /** Upper bound for OKLCH chroma — shared with the embedded picker. NEVER
   * clamps an author-specified chroma down (CLAUDE.md's "never clamp/drop"
   * rule, review finding #2c): `init`/`setGradient` RAISE this to fit
   * whatever chroma the input actually contains instead. */
  maxChroma: number
  /** `removeStop` refuses to go below this many stops; `init` PADS up to it
   * if given fewer; `setGradient` REJECTS a parse that would drop below it
   * (never truncates/pads a user-authored CSS gradient — see the module doc
   * on `setGradient`). Default 2. Always a positive integer. */
  minStops: number
  /**
   * Upper bound on stop count, or ABSENT for unbounded. Follows the
   * package's UNBOUNDED-CAPABLE idiom (CLAUDE.md #177, `breadcrumbs.
   * maxVisible`): the key is OMITTED rather than holding `null`, so a
   * `JSON.parse(JSON.stringify(state))` round trip is a key-for-key
   * identity. Always a positive integer `>= minStops` when present — `init`
   * normalizes a non-integer or too-low value rather than producing a
   * config that could never be satisfied.
   */
  maxStops?: number
  disabled: boolean
  /** Reading direction. Under `rtl`, the track's physical left/right (both
   * the stop ramp's own background angle and each stop's `left%`) mirrors —
   * see `mirrorForDir`'s doc comment on why this differs from
   * `color-picker`'s (native-input) hue slider. */
  dir: 'ltr' | 'rtl'
  /** Whether the browser's EyeDropper API is available — mirrors
   * `color-picker`'s own `eyeDropperSupported` field (never `true` at
   * `init()`; only `eyeDropperSupportMount`, wired through the `picker`
   * wrapper in `connect()`, ever flips it). Lives at the GRADIENT level, not
   * per-stop — it is a mount-time browser capability, not a color. */
  eyeDropperSupported: boolean
  /** The uncommitted `cssInput` text while the user is actively editing, or
   * `null` when not editing (display falls back to the live `toCss(state)`
   * value). Kept OUT of the committed gradient so the input's own caret
   * never jumps mid-keystroke — see `setGradientDraft`/`setGradient`. */
  cssDraft: string | null
  /** The reason the last `setGradient` attempt failed, or `null`. Cleared by
   * the NEXT successful `setGradient`; typing (`setGradientDraft`) does NOT
   * clear it, so the error stays visible while the user is mid-correction. */
  cssError: string | null
}

/** @intent group */
export type GradientPickerMsg =
  /** @intent("Add a stop at `position` (0-100), colored EXACTLY what the gradient already renders there") */
  | { type: 'addStop'; position: number }
  /** @intent("Remove the stop with the given id. Refused below `minStops`; a removed selection reselects a neighbour") */
  | { type: 'removeStop'; id: string }
  /** @humanOnly */
  | { type: 'selectStop'; id: string }
  /** @intent("Move the stop with the given id to `position` (0-100, clamped), keeping sort order and selection") */
  | { type: 'moveStop'; id: string; position: number }
  /** @intent("Move the stop with the given id by a signed `delta` (0-100 units)") */
  | { type: 'nudgeStop'; id: string; delta: number }
  /** @intent("Switch the gradient kind (linear/radial/conic)") */
  | { type: 'setKind'; kind: GradientKind }
  /** @intent("Toggle the `repeating-` form of the current gradient kind") */
  | { type: 'setRepeating'; repeating: boolean }
  /** @intent("Set an EXPLICIT angle in degrees — linear's direction (converting away from a to-keyword direction) or conic's `from` angle. No-op for radial. Normalized to [0,360)") */
  | { type: 'setAngle'; angle: number }
  /** @intent("Set the center position (percent 0-100 each axis) — radial and conic only") */
  | { type: 'setCenter'; x: number; y: number }
  /** @intent("Set the radial gradient's shape (circle/ellipse)") */
  | { type: 'setShape'; shape: RadialShape }
  /** @intent("Set the radial gradient's extent keyword") */
  | { type: 'setSize'; size: RadialSize }
  /** @intent("Set the color-interpolation-method: the space, and (polar spaces only) the hue method") */
  | { type: 'setInterpolation'; space: InterpolationSpace; hue?: HueInterpolationMethod }
  /** @intent("Reverse the stop order (mirrors every stop's position about the middle)") */
  | { type: 'reverse' }
  /** @intent("Space every stop evenly across 0-100, preserving relative order") */
  | { type: 'distribute' }
  /** @humanOnly */
  | { type: 'setGradientDraft'; value: string }
  /** @intent("Parse `css` and, if valid AND within min/maxStops, replace the whole gradient. Invalid input (or a stop count outside min/maxStops) sets a describable error and leaves the gradient unchanged") */
  | { type: 'setGradient'; css: string }
  /** @intent("Edit the color/alpha of the SELECTED stop through the embedded color-picker's own message set") */
  | { type: 'picker'; msg: ColorPickerMsg }
  /** @humanOnly */
  | { type: 'selectNextStop' }
  /** @humanOnly */
  | { type: 'selectPrevStop' }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }

export interface GradientStopInit {
  color?: PickerColor | string
  alpha?: number
  position: number
}

export interface GradientPickerInit {
  /** Parse an initial gradient from a CSS string (via {@link parseGradient}).
   * Takes precedence over `stops`/`kind`/… below. Invalid CSS (or a stop
   * count outside `minStops`/`maxStops`) falls back to the `stops`/defaults
   * path below, same as `color-picker`'s `color` option falling back on an
   * unparsable string. */
  css?: string
  /** Explicit initial stops (ignored if `css` parses). An EMPTY array is
   * treated the same as omitting the option (never an empty gradient — see
   * finding #7); fewer than `minStops` are PADDED. Sorted by `position` on
   * init; ids are assigned sequentially in the SORTED order. */
  stops?: GradientStopInit[]
  kind?: GradientKind
  repeating?: boolean
  /** Sets the initial direction as an explicit angle (linear) or `from`
   * angle (conic). For a `to <side>` initial direction, use `css` instead. */
  angle?: number
  center?: Partial<GradientCenter>
  shape?: RadialShape
  size?: RadialSize
  interpolation?: Partial<GradientInterpolation>
  /** Which model a stop with no explicit `PickerColor`/parseable string
   * starts in. Default `'hsv'`. */
  defaultModel?: ColorModel
  maxChroma?: number
  minStops?: number
  maxStops?: number
  disabled?: boolean
  dir?: 'ltr' | 'rtl'
}

// ── Small enums as runtime guards (defensive against an agent/host sending a
// value that only TYPE-CHECKS as the union, e.g. through a loosely-typed
// bridge) ───────────────────────────────────────────────────────────────────

const GRADIENT_KINDS: readonly GradientKind[] = ['linear', 'radial', 'conic']
const RADIAL_SHAPES: readonly RadialShape[] = ['circle', 'ellipse']
const RADIAL_SIZES: readonly RadialSize[] = [
  'closest-side',
  'closest-corner',
  'farthest-side',
  'farthest-corner',
]
const INTERPOLATION_SPACES: readonly InterpolationSpace[] = [
  'srgb',
  'srgb-linear',
  'oklab',
  'oklch',
  'hsl',
]
const HUE_METHODS: readonly HueInterpolationMethod[] = [
  'shorter',
  'longer',
  'increasing',
  'decreasing',
]
const DIR_VALUES: readonly ('ltr' | 'rtl')[] = ['ltr', 'rtl']
const COLOR_MODELS: readonly ColorModel[] = ['hsv', 'oklch']

function isGradientKind(v: string): v is GradientKind {
  return (GRADIENT_KINDS as readonly string[]).includes(v)
}
function isRadialShape(v: string): v is RadialShape {
  return (RADIAL_SHAPES as readonly string[]).includes(v)
}
function isRadialSize(v: string): v is RadialSize {
  return (RADIAL_SIZES as readonly string[]).includes(v)
}
function isInterpolationSpace(v: string): v is InterpolationSpace {
  return (INTERPOLATION_SPACES as readonly string[]).includes(v)
}
function isHueMethod(v: string): v is HueInterpolationMethod {
  return (HUE_METHODS as readonly string[]).includes(v)
}
function isDirValue(v: string): v is 'ltr' | 'rtl' {
  return (DIR_VALUES as readonly string[]).includes(v)
}
function isColorModel(v: string): v is ColorModel {
  return (COLOR_MODELS as readonly string[]).includes(v)
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * The default `<color-interpolation-method>` a `parseGradient`/`setGradient`
 * input gets when it names no explicit `in <space>`: `srgb` when every stop
 * uses a LEGACY color syntax (hex, `rgb()`/`hsl()`/`hwb()`, a named color),
 * `oklab` otherwise — CSS Images 4's own resolution (backwards-compatible
 * sRGB interpolation for an author who never opted into anything newer;
 * Oklab once ANY stop uses a modern syntax that implies one). This is
 * independently confirmed against real Chromium rendering by
 * `gradient-picker.browser.test.ts`'s "legacy default space" case, not
 * resting on spec text alone. A fresh `init()` with no `css`/explicit
 * `interpolation` (built from `PickerColor` objects, not CSS text) has no
 * "syntax" to classify and keeps the simpler, separately-documented
 * `oklab`/`shorter` default below.
 */
const DEFAULT_INTERPOLATION: GradientInterpolation = { space: 'oklab', hue: 'shorter' }

const DEFAULT_INIT_STOPS: readonly GradientStopInit[] = [
  { position: 0, color: { model: 'hsv', h: 0, s: 0, v: 0 } },
  { position: 100, color: { model: 'hsv', h: 0, s: 0, v: 100 } },
]

// ── Stop construction / ordering helpers ────────────────────────────────────

function pickerColorOf(
  input: PickerColor | string | undefined,
  defaultModel: ColorModel,
): { color: PickerColor; alpha: number | undefined } {
  const fallback: PickerColor =
    defaultModel === 'oklch'
      ? { model: 'oklch', l: 0, c: 0, h: 0 }
      : { model: 'hsv', h: 0, s: 0, v: 0 }
  if (input === undefined) return { color: fallback, alpha: undefined }
  if (typeof input !== 'string') return { color: input, alpha: undefined }
  const parsed = parseCssColor(input)
  if (!parsed) return { color: fallback, alpha: undefined }
  const model: ColorModel = parsed.space === 'oklch' || parsed.space === 'oklab' ? 'oklch' : 'hsv'
  // Infinity: never clip an author's chroma here — `init` raises
  // `maxChroma` to fit AFTER seeing every stop (finding #2c).
  return cssColorToPickerColor(parsed, model, Infinity)
}

/** The largest OKLCH chroma among `stops`, or `current` if none exceeds it —
 * the "raise, never clamp" half of finding #2c. */
function neededMaxChroma(stops: ReadonlyArray<{ color: PickerColor }>, current: number): number {
  let max = current
  for (const s of stops) {
    if (s.color.model === 'oklch' && s.color.c > max) max = s.color.c
  }
  return max
}

function buildStopsFromOptions(
  rawStops: readonly GradientStopInit[],
  defaultModel: ColorModel,
): { stops: GradientStop[]; nextId: number; maxChroma: number } {
  const withColors = rawStops.map((s) => {
    const { color, alpha } = pickerColorOf(s.color, defaultModel)
    return {
      color,
      alpha: clamp(finiteOrDefault(s.alpha ?? alpha, 1), 0, 1),
      position: clamp(finiteOrDefault(s.position, 0), 0, 100),
    }
  })
  // Array#sort is stable (ES2019+): stops at equal positions keep the order
  // they were given in, matching the "stable on ties by insertion" rule.
  const sorted = [...withColors].sort((a, b) => a.position - b.position)
  const stops = sorted.map((s, i) => ({ id: `s${i + 1}`, ...s }))
  return { stops, nextId: stops.length + 1, maxChroma: neededMaxChroma(stops, 0) }
}

/** Insert `stop` keeping ascending order; ties go AFTER the existing run at
 * that position (stable-by-insertion, same rule `buildStopsFromOptions`
 * uses). */
function insertSorted(stops: readonly GradientStop[], stop: GradientStop): GradientStop[] {
  const next = [...stops]
  let idx = next.length
  for (let i = 0; i < next.length; i++) {
    if (next[i]!.position > stop.position) {
      idx = i
      break
    }
  }
  next.splice(idx, 0, stop)
  return next
}

/**
 * Pad `stops` up to `minStops` by duplicating the color of whichever
 * existing stop sits closest to a new position at the current largest gap's
 * midpoint — cheap, deterministic, and never invents a color the gradient
 * did not already contain somewhere. Only reachable from `init` (a
 * constructor has no prior valid state to fall back to); `setGradient`
 * REJECTS a too-short parse instead — see the module doc on both.
 */
function padToMinStops(
  stops: readonly GradientStop[],
  minStops: number,
  nextIdStart: number,
): { stops: GradientStop[]; nextId: number } {
  let result = [...stops]
  let nextId = nextIdStart
  while (result.length < minStops) {
    const position = largestGapMidpoint(result)
    const nearest = result.reduce((best, s) =>
      Math.abs(s.position - position) < Math.abs(best.position - position) ? s : best,
    )
    result = insertSorted(result, {
      id: `s${nextId}`,
      color: nearest.color,
      alpha: nearest.alpha,
      position,
    })
    nextId += 1
  }
  return { stops: result, nextId }
}

function repositionStop(
  state: GradientPickerState,
  id: string,
  rawPosition: number,
): GradientPickerState {
  const idx = state.stops.findIndex((s) => s.id === id)
  if (idx === -1) return state
  const position = clamp(rawPosition, 0, 100)
  const moved = { ...state.stops[idx]!, position }
  const stops = insertSorted(
    state.stops.filter((s) => s.id !== id),
    moved,
  )
  return { ...state, stops }
}

function findStop(state: GradientPickerState, id: string): GradientStop | undefined {
  return state.stops.find((s) => s.id === id)
}

/** NEVER throws, even from an (unreachable in practice — every mutation path
 * guarantees `stops.length >= minStops >= 1`) empty `stops` array — finding
 * #7 requires `pickerStateOf` to never surface a plain `TypeError`. */
function selectedStop(state: GradientPickerState): GradientStop {
  const found = findStop(state, state.selectedId)
  if (found) return found
  const first = state.stops[0]
  if (first) return first
  return { id: state.selectedId, color: { model: 'hsv', h: 0, s: 0, v: 0 }, alpha: 1, position: 0 }
}

// ── init ─────────────────────────────────────────────────────────────────────

/** A positive integer, or `undefined` when `raw` is unusable — `maxStops`'s
 * own normalizer (finding #7: `0.5` must never produce a fractional cap that
 * `slice`/`>=` then treats inconsistently). */
function positiveIntegerOrUndefined(raw: number | undefined): number | undefined {
  const v = positiveFinite(raw)
  return v === undefined ? undefined : Math.max(1, Math.round(v))
}

export function init(opts: GradientPickerInit = {}): GradientPickerState {
  const requestedMaxChroma = positiveFinite(opts.maxChroma) ?? DEFAULT_MAX_CHROMA
  const minStops = Math.max(1, Math.round(finiteOrDefault(opts.minStops, 2)))
  // maxStops is never allowed to contradict minStops (finding #7): a config
  // asking for fewer than it also requires is impossible to satisfy, so the
  // cap widens to match rather than the two silently fighting at runtime.
  const requestedMaxStops = positiveIntegerOrUndefined(opts.maxStops)
  const maxStops =
    requestedMaxStops === undefined ? undefined : Math.max(minStops, requestedMaxStops)
  const defaultModel: ColorModel =
    opts.defaultModel !== undefined && isColorModel(opts.defaultModel) ? opts.defaultModel : 'hsv'
  const disabled = opts.disabled ?? false
  const dir = opts.dir ?? 'ltr'
  const maxStopsField = maxStops !== undefined ? { maxStops } : {}
  const common = {
    defaultModel,
    minStops,
    ...maxStopsField,
    disabled,
    dir,
    eyeDropperSupported: false,
    cssDraft: null,
    cssError: null,
  }

  if (opts.css !== undefined) {
    const parsed = parseGradient(opts.css)
    // A stop count outside min/maxStops is treated the same as an unparsable
    // string — falls through to the stops/defaults path below — because
    // `init` has no prior valid state to reject BACK to (unlike
    // `setGradient`, which keeps the old state and surfaces `cssError`).
    if (
      parsed.ok &&
      parsed.value.stops.length >= minStops &&
      (maxStops === undefined || parsed.value.stops.length <= maxStops)
    ) {
      const built = buildStopsFromParsedStops(parsed.value.stops, minStops)
      const maxChroma = neededMaxChroma(built.stops, requestedMaxChroma)
      return {
        kind: parsed.value.kind,
        repeating: parsed.value.repeating,
        direction: parsed.value.direction,
        conicAngle: parsed.value.conicAngle,
        center: parsed.value.center,
        shape: parsed.value.shape,
        size: parsed.value.size,
        interpolation: parsed.value.interpolation,
        stops: built.stops,
        selectedId: built.stops[0]?.id ?? 's1',
        nextId: built.nextId,
        maxChroma,
        ...common,
      }
    }
    // Invalid/out-of-range CSS falls through to the explicit-stops / default
    // path, same fallback shape as `colorPicker.init`'s `color` option.
  }

  // An explicitly empty array is treated as "omitted" — never an empty
  // gradient (finding #7).
  const requestedStops = opts.stops && opts.stops.length > 0 ? opts.stops : DEFAULT_INIT_STOPS
  const built = buildStopsFromOptions(requestedStops, defaultModel)
  const padded = padToMinStops(built.stops, minStops, built.nextId)
  const maxChroma = neededMaxChroma(padded.stops, Math.max(requestedMaxChroma, built.maxChroma))

  return {
    kind: opts.kind ?? 'linear',
    repeating: opts.repeating ?? false,
    direction: { type: 'angle', deg: normalizeAngle(finiteOrDefault(opts.angle, 90)) },
    conicAngle: normalizeAngle(finiteOrDefault(opts.angle, 0)),
    center: {
      x: clamp(finiteOrDefault(opts.center?.x, 50), 0, 100),
      y: clamp(finiteOrDefault(opts.center?.y, 50), 0, 100),
    },
    shape: opts.shape ?? 'ellipse',
    size: opts.size ?? 'farthest-corner',
    interpolation: {
      space: opts.interpolation?.space ?? DEFAULT_INTERPOLATION.space,
      hue: opts.interpolation?.hue ?? DEFAULT_INTERPOLATION.hue,
    },
    stops: padded.stops,
    selectedId: padded.stops[0]?.id ?? 's1',
    nextId: padded.nextId,
    maxChroma,
    ...common,
  }
}

/** Assign sequential ids to already-parsed stops (never chroma-clamped —
 * `parseStopList` parses with `Infinity`), then pad to `minStops` if the
 * parse came up short (only reachable from `init`; see `padToMinStops`). */
function buildStopsFromParsedStops(
  parsedStops: ReadonlyArray<{ color: PickerColor; alpha: number; position: number }>,
  minStops: number,
): { stops: GradientStop[]; nextId: number } {
  const stops = parsedStops.map((s, i) => ({ id: `s${i + 1}`, ...s }))
  return padToMinStops(stops, minStops, stops.length + 1)
}

// ── pickerStateOf / update ───────────────────────────────────────────────────

/**
 * Build the `ColorPickerState` the embedded picker edits: the SELECTED
 * stop's OWN color+alpha, verbatim — no HSV<->OKLCH projection. This is what
 * keeps a picker edit from destroying an out-of-gamut OKLCH stop's other
 * channels (review finding #1: `oklch(0.7 0.3 150)` + `setAlpha 0.5` used to
 * come back `hsv #00c24780` because the OLD version re-projected onto a
 * shared "active model" on every edit). `update()`'s `'picker'` case is what
 * writes the result back onto the stop; a stop's model changes ONLY via an
 * explicit `setModel` picker message, which is `color-picker`'s own reducer
 * — nothing here decides it.
 */
export function pickerStateOf(state: GradientPickerState): ColorPickerState {
  const stop = selectedStop(state)
  return {
    color: stop.color,
    alpha: stop.alpha,
    disabled: state.disabled,
    maxChroma: state.maxChroma,
    eyeDropperSupported: state.eyeDropperSupported,
  }
}

export function update(
  state: GradientPickerState,
  msg: GradientPickerMsg,
): [GradientPickerState, never[]] {
  if (
    (msg.type === 'addStop' && !allFiniteNumbers(msg.position)) ||
    (msg.type === 'moveStop' && !allFiniteNumbers(msg.position)) ||
    (msg.type === 'nudgeStop' && !allFiniteNumbers(msg.delta)) ||
    (msg.type === 'setAngle' && !allFiniteNumbers(msg.angle)) ||
    (msg.type === 'setCenter' && !allFiniteNumbers(msg.x, msg.y))
  ) {
    return [state, []]
  }
  if (state.disabled) return [state, []]

  switch (msg.type) {
    case 'addStop': {
      const position = clamp(msg.position, 0, 100)
      const cssStr = colorAt(state, position)
      const parsed = parseCssColor(cssStr)
      if (!parsed) return [state, []]
      const model: ColorModel =
        parsed.space === 'oklch' || parsed.space === 'oklab' ? 'oklch' : 'hsv'
      const { color, alpha } = cssColorToPickerColor(parsed, model, state.maxChroma)
      if (state.maxStops !== undefined && state.stops.length >= state.maxStops) {
        return [state, []]
      }
      const id = `s${state.nextId}`
      const stops = insertSorted(state.stops, { id, color, alpha, position })
      return [{ ...state, stops, selectedId: id, nextId: state.nextId + 1 }, []]
    }
    case 'removeStop': {
      if (state.stops.length <= state.minStops) return [state, []]
      const idx = state.stops.findIndex((s) => s.id === msg.id)
      if (idx === -1) return [state, []]
      const stops = state.stops.filter((s) => s.id !== msg.id)
      let selectedId = state.selectedId
      if (selectedId === msg.id) {
        const neighbour = stops[idx] ?? stops[idx - 1] ?? stops[0]
        selectedId = neighbour ? neighbour.id : state.selectedId
      }
      return [{ ...state, stops, selectedId }, []]
    }
    case 'selectStop':
      return state.stops.some((s) => s.id === msg.id)
        ? [{ ...state, selectedId: msg.id }, []]
        : [state, []]
    case 'moveStop':
      return [repositionStop(state, msg.id, msg.position), []]
    case 'nudgeStop': {
      const stop = findStop(state, msg.id)
      if (!stop) return [state, []]
      return [repositionStop(state, msg.id, stop.position + msg.delta), []]
    }
    case 'setKind':
      return isGradientKind(msg.kind) ? [{ ...state, kind: msg.kind }, []] : [state, []]
    case 'setRepeating':
      return [{ ...state, repeating: msg.repeating }, []]
    case 'setAngle': {
      const deg = normalizeAngle(msg.angle)
      if (state.kind === 'linear') return [{ ...state, direction: { type: 'angle', deg } }, []]
      if (state.kind === 'conic') return [{ ...state, conicAngle: deg }, []]
      return [state, []] // radial has no angle
    }
    case 'setCenter':
      return [{ ...state, center: { x: clamp(msg.x, 0, 100), y: clamp(msg.y, 0, 100) } }, []]
    case 'setShape':
      return isRadialShape(msg.shape) ? [{ ...state, shape: msg.shape }, []] : [state, []]
    case 'setSize':
      return isRadialSize(msg.size) ? [{ ...state, size: msg.size }, []] : [state, []]
    case 'setInterpolation': {
      if (!isInterpolationSpace(msg.space)) return [state, []]
      const hue = msg.hue !== undefined && isHueMethod(msg.hue) ? msg.hue : state.interpolation.hue
      return [{ ...state, interpolation: { space: msg.space, hue } }, []]
    }
    case 'reverse': {
      const stops = state.stops.map((s) => ({ ...s, position: 100 - s.position })).reverse()
      return [{ ...state, stops }, []]
    }
    case 'distribute': {
      const n = state.stops.length
      if (n <= 1) return [state, []]
      const stops = state.stops.map((s, i) => ({ ...s, position: (i / (n - 1)) * 100 }))
      return [{ ...state, stops }, []]
    }
    case 'setGradientDraft':
      return [{ ...state, cssDraft: msg.value }, []]
    case 'setGradient': {
      const parsed = parseGradient(msg.css)
      if (!parsed.ok) {
        return [{ ...state, cssDraft: msg.css, cssError: parsed.reason }, []]
      }
      // Never truncate/pad a user-authored gradient (finding #2c): reject
      // the whole edit and keep the OLD valid state instead.
      if (parsed.value.stops.length < state.minStops) {
        return [
          {
            ...state,
            cssDraft: msg.css,
            cssError: `needs at least ${state.minStops} stops, got ${parsed.value.stops.length}`,
          },
          [],
        ]
      }
      if (state.maxStops !== undefined && parsed.value.stops.length > state.maxStops) {
        return [
          {
            ...state,
            cssDraft: msg.css,
            cssError: `at most ${state.maxStops} stops are allowed, got ${parsed.value.stops.length}`,
          },
          [],
        ]
      }

      // Selection preserved by POSITION-INDEX (finding #6): where in the OLD
      // sorted array the current selection sat, clamped into the new array.
      const oldIndex = state.stops.findIndex((s) => s.id === state.selectedId)

      // Ids stay MONOTONE (finding #6) — continue `nextId` rather than
      // restarting at `s1`, so an id a consumer captured earlier is never
      // reissued to a different stop.
      let nextId = state.nextId
      const stops = parsed.value.stops.map((s) => {
        const id = `s${nextId}`
        nextId += 1
        return { id, ...s }
      })
      const selectedIndex = oldIndex === -1 ? 0 : Math.min(oldIndex, stops.length - 1)
      const selectedId = stops[selectedIndex]?.id ?? stops[0]!.id

      // Never clamp an author-specified chroma (finding #2c) — raise instead.
      const maxChroma = neededMaxChroma(stops, state.maxChroma)

      return [
        {
          ...state,
          kind: parsed.value.kind,
          repeating: parsed.value.repeating,
          direction: parsed.value.direction,
          conicAngle: parsed.value.conicAngle,
          center: parsed.value.center,
          shape: parsed.value.shape,
          size: parsed.value.size,
          interpolation: parsed.value.interpolation,
          stops,
          selectedId,
          nextId,
          maxChroma,
          cssDraft: null,
          cssError: null,
        },
        [],
      ]
    }
    case 'picker': {
      const derived = pickerStateOf(state)
      const [next] = colorPickerUpdate(derived, msg.msg)
      const stops = state.stops.map((s) =>
        s.id === state.selectedId ? { ...s, color: next.color, alpha: next.alpha } : s,
      )
      return [{ ...state, stops, eyeDropperSupported: next.eyeDropperSupported }, []]
    }
    case 'selectNextStop': {
      const idx = state.stops.findIndex((s) => s.id === state.selectedId)
      const next = idx === -1 ? undefined : state.stops[idx + 1]
      return next ? [{ ...state, selectedId: next.id }, []] : [state, []]
    }
    case 'selectPrevStop': {
      const idx = state.stops.findIndex((s) => s.id === state.selectedId)
      const prev = idx > 0 ? state.stops[idx - 1] : undefined
      return prev ? [{ ...state, selectedId: prev.id }, []] : [state, []]
    }
    case 'setDir':
      return isDirValue(msg.dir) ? [{ ...state, dir: msg.dir }, []] : [state, []]
  }
}

// ── Pure rendering helpers: toCss / colorAt ─────────────────────────────────

function formatStopColor(stop: { color: PickerColor; alpha: number }): string {
  return pickerColorToCss(stop.color, stop.alpha)
}

function fmtNum(n: number): string {
  const s = n.toFixed(4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function interpolationHead(interpolation: GradientInterpolation): string {
  const { space, hue } = interpolation
  const isPolar = space === 'hsl' || space === 'oklch'
  const hueSuffix = isPolar && hue !== 'shorter' ? ` ${hue} hue` : ''
  return `in ${space}${hueSuffix}`
}

/** THE ONE stop-list serializer — used by both `toCss` and the `track`
 * part's own background (finding #3: "the track must show what colorAt
 * returns", which starts with them never being built from two independent
 * strings that could drift). */
function gradientStopListCss(stops: readonly GradientStop[]): string {
  return stops.map((s) => `${formatStopColor(s)} ${fmtNum(s.position)}%`).join(', ')
}

/** `to <side-or-corner>` CSS text for a `{type:'to'}` direction — the
 * canonical vertical-then-horizontal keyword order (`to top right`, not `to
 * right top`; CSS accepts either on input but this is what browsers
 * serialize back). */
function directionToCss(direction: Extract<GradientDirection, { type: 'to' }>): string {
  const words = [direction.y, direction.x].filter(
    (v): v is 'top' | 'bottom' | 'left' | 'right' => v !== undefined,
  )
  return `to ${words.join(' ')}`
}

/** The direction's equivalent angle in degrees, for display (`angleInput`'s
 * numeric value, the angle-slider composition) — reading this NEVER converts
 * the stored direction; only the `setAngle` message does that. */
function directionAngleDeg(direction: GradientDirection): number {
  if (direction.type === 'angle') return direction.deg
  return sideOrCornerToAngle(
    [direction.y, direction.x].filter(
      (v): v is 'top' | 'bottom' | 'left' | 'right' => v !== undefined,
    ),
  )
}

/**
 * Serialize to a real CSS `<gradient>` — always with an explicit
 * `in <space>` (plus the hue method, only for a polar space and only when it
 * is not the `shorter` default) so the string never depends on a browser's
 * own default. Stop colors go through `color-picker`'s own `toCss` rule
 * ({@link formatStopColor}), so an out-of-gamut OKLCH stop stays exact
 * instead of being silently gamut-mapped through a hex round trip.
 */
export function toCss(state: GradientPickerState): string {
  const stopList = gradientStopListCss(state.stops)
  const interp = interpolationHead(state.interpolation)
  const prefix = state.repeating ? 'repeating-' : ''

  // CSS Images 4 grammar: the head (angle/shape/position PLUS the
  // color-interpolation-method) is ONE space-separated unit; a comma
  // introduces the color-stop-list, never appears INSIDE the head.
  switch (state.kind) {
    case 'linear': {
      const dirCss =
        state.direction.type === 'angle'
          ? `${fmtNum(normalizeAngle(state.direction.deg))}deg`
          : directionToCss(state.direction)
      const head = `${dirCss} ${interp}`
      return `${prefix}linear-gradient(${head}, ${stopList})`
    }
    case 'radial': {
      const head =
        `${state.shape} ${state.size} ` +
        `at ${fmtNum(state.center.x)}% ${fmtNum(state.center.y)}% ${interp}`
      return `${prefix}radial-gradient(${head}, ${stopList})`
    }
    case 'conic': {
      const head =
        `from ${fmtNum(normalizeAngle(state.conicAngle))}deg ` +
        `at ${fmtNum(state.center.x)}% ${fmtNum(state.center.y)}% ${interp}`
      return `${prefix}conic-gradient(${head}, ${stopList})`
    }
  }
}

function formatInterpolatedColor(c: CssColor): string {
  const alpha = cssColorAlpha(c)
  switch (c.space) {
    case 'oklch':
      return formatOklch({ l: resolveNone(c.l), c: resolveNone(c.c), h: resolveNone(c.h) }, alpha)
    case 'oklab':
      return formatOklab({ l: resolveNone(c.l), a: resolveNone(c.a), b: resolveNone(c.b) }, alpha)
    case 'hsl':
      return formatHsl({ h: resolveNone(c.h), s: resolveNone(c.s), l: resolveNone(c.l) }, alpha)
    case 'srgb':
    case 'srgb-linear': {
      const rgb = srgbToRgb255(cssColorToSrgb(c))
      return alpha >= 1 ? formatHex(rgb) : formatHex8(rgb, alpha)
    }
  }
}

/**
 * The color the gradient renders at `position` (0–100, one cycle — see the
 * module doc comment), computed the same way the browser would: when
 * `repeating` is on, `position` is first WRAPPED by the stop range's own
 * period `[first.position, last.position)` — exactly how a real
 * `repeating-linear-gradient` paints past its last stop — before anything
 * else runs. An exact stop match then returns that stop's own color;
 * otherwise the two bracketing stops are interpolated in
 * `state.interpolation`. `addStop` stores EXACTLY this string
 * (round-tripped through `parseCssColor`), so a new stop is
 * indistinguishable from the gradient it was picked off.
 */
export function colorAt(state: GradientPickerState, position: number): string {
  const stops = state.stops
  if (stops.length === 0) return '#000000' // defensive-only; see `selectedStop`'s doc
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  const period = last.position - first.position

  let queryPosition = position
  if (state.repeating && period > 0) {
    const offset = (((position - first.position) % period) + period) % period
    queryPosition = first.position + offset
  }

  const exact = stops.find((s) => s.position === queryPosition)
  if (exact) return formatStopColor(exact)
  if (queryPosition <= first.position) return formatStopColor(first)
  if (queryPosition >= last.position) return formatStopColor(last)

  let a = first
  let b = last
  for (let i = 0; i < stops.length - 1; i++) {
    const left = stops[i]!
    const right = stops[i + 1]!
    if (left.position <= queryPosition && queryPosition <= right.position) {
      a = left
      b = right
      break
    }
  }
  const t = b.position === a.position ? 0 : (queryPosition - a.position) / (b.position - a.position)
  const interpolated = interpolateColor(
    pickerColorToCssColor(a.color, a.alpha),
    pickerColorToCssColor(b.color, b.alpha),
    t,
    state.interpolation.space,
    state.interpolation.hue,
  )
  return formatInterpolatedColor(interpolated)
}

// ── parseGradient ────────────────────────────────────────────────────────────

export interface ParsedGradient {
  kind: GradientKind
  repeating: boolean
  direction: GradientDirection
  conicAngle: number
  center: GradientCenter
  shape: RadialShape
  size: RadialSize
  interpolation: GradientInterpolation
  stops: Array<{ color: PickerColor; alpha: number; position: number }>
}

export type ParseGradientResult =
  | { ok: true; value: ParsedGradient }
  | { ok: false; reason: string }

const GRADIENT_HEAD_RE = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/is

function isBalanced(s: string): boolean {
  let depth = 0
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function splitTopLevelBy(s: string, isBoundary: (ch: string) => boolean): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && isBoundary(ch)) {
      if (current.length > 0) parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.length > 0) parts.push(current)
  return parts
}

function splitTopLevelCommas(s: string): string[] {
  return splitTopLevelBy(s, (ch) => ch === ',').map((p) => p.trim())
}

function splitTopLevelWhitespace(s: string): string[] {
  return splitTopLevelBy(s, (ch) => /\s/.test(ch))
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function parseAngleToken(tok: string): number | null {
  const m = /^(-?[\d.]+(?:e-?\d+)?)(deg|grad|rad|turn)$/i.exec(tok)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2]!.toLowerCase()
  if (unit === 'grad') return normalizeAngle(n * 0.9)
  if (unit === 'rad') return normalizeAngle((n * 180) / Math.PI)
  if (unit === 'turn') return normalizeAngle(n * 360)
  return normalizeAngle(n)
}

/**
 * `to <side-or-corner>` mapped onto a fixed angle in 45° multiples — used
 * only for DISPLAY (`directionAngleDeg`); the stored direction stays a
 * keyword until an explicit `setAngle`. This is a DELIBERATE simplification:
 * CSS's real corner angle depends on the box's aspect ratio, which a
 * headless machine with no rendered box has no way to know. `to top`/
 * `right`/`bottom`/`left` are exact regardless (0/90/180/270) either way;
 * only the four corners are approximated.
 */
function sideOrCornerToAngle(tokens: readonly string[]): number {
  const key = tokens
    .map((t) => t.toLowerCase())
    .sort()
    .join(' ')
  const MAP: Record<string, number> = {
    top: 0,
    right: 90,
    bottom: 180,
    left: 270,
    'right top': 45,
    'bottom right': 135,
    'bottom left': 225,
    'left top': 315,
  }
  return MAP[key] ?? 180
}

/** The inverse of `sideOrCornerToAngle`'s token map — parses `to <tokens>`
 * into a structured direction, or `null` for an unrecognized combination. */
function parseSideOrCorner(
  tokens: readonly string[],
): Extract<GradientDirection, { type: 'to' }> | null {
  const lower = tokens.map((t) => t.toLowerCase())
  if (lower.length === 1) {
    const [t] = lower as [string]
    if (t === 'top' || t === 'bottom') return { type: 'to', y: t }
    if (t === 'left' || t === 'right') return { type: 'to', x: t }
    return null
  }
  if (lower.length === 2) {
    const x = lower.includes('left') ? 'left' : lower.includes('right') ? 'right' : undefined
    const y = lower.includes('top') ? 'top' : lower.includes('bottom') ? 'bottom' : undefined
    if (x === undefined || y === undefined) return null
    return { type: 'to', x, y }
  }
  return null
}

function parsePositionAxisToken(tok: string, axis: 'x' | 'y'): number | null {
  const lower = tok.toLowerCase()
  if (lower === 'center') return 50
  if (axis === 'x' && lower === 'left') return 0
  if (axis === 'x' && lower === 'right') return 100
  if (axis === 'y' && lower === 'top') return 0
  if (axis === 'y' && lower === 'bottom') return 100
  if (lower.endsWith('%')) {
    const n = Number(lower.slice(0, -1))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parsePosition(
  tokens: readonly string[],
): { ok: true; value: GradientCenter } | { ok: false; reason: string } {
  if (tokens.length === 0) return { ok: false, reason: 'expected a position after "at"' }
  if (tokens.length > 2) {
    return { ok: false, reason: `too many position tokens "${tokens.join(' ')}"` }
  }
  const unsupported = {
    ok: false as const,
    reason:
      `unsupported position "${tokens.join(' ')}" — only percentages and ` +
      'left/center/right/top/bottom keywords are supported (lengths like px are not)',
  }
  if (tokens.length === 1) {
    const tok = tokens[0]!.toLowerCase()
    if (tok === 'top' || tok === 'bottom') {
      const y = parsePositionAxisToken(tok, 'y')
      return y === null ? unsupported : { ok: true, value: { x: 50, y } }
    }
    const x = parsePositionAxisToken(tok, 'x')
    return x === null ? unsupported : { ok: true, value: { x, y: 50 } }
  }
  const x = parsePositionAxisToken(tokens[0]!, 'x')
  const y = parsePositionAxisToken(tokens[1]!, 'y')
  return x === null || y === null ? unsupported : { ok: true, value: { x, y } }
}

interface ParsedHead {
  direction: GradientDirection
  conicAngle: number
  center: GradientCenter
  shape: RadialShape
  size: RadialSize
  /** `null` — omitted — resolves to `srgb`/`oklab` per the whole gradient's
   * stops (finding #2a); resolved by `parseGradient`, which is the only
   * place that has BOTH the head and the stop list. */
  interpolation: GradientInterpolation | null
}

function extractInterpolation(
  tokens: readonly string[],
):
  | { ok: true; tokens: string[]; interpolation: GradientInterpolation | null }
  | { ok: false; reason: string } {
  const inIdx = tokens.findIndex((t) => t.toLowerCase() === 'in')
  if (inIdx === -1) return { ok: true, tokens: [...tokens], interpolation: null }

  const spaceTok = tokens[inIdx + 1]?.toLowerCase()
  if (spaceTok === undefined || !isInterpolationSpace(spaceTok)) {
    return {
      ok: false,
      reason: `unknown color-interpolation-method space "${tokens[inIdx + 1] ?? ''}"`,
    }
  }
  let consumed = 2
  let hue: HueInterpolationMethod = 'shorter'
  const hueTok = tokens[inIdx + 2]?.toLowerCase()
  const hueWord = tokens[inIdx + 3]?.toLowerCase()
  const hasHueMethod = hueTok !== undefined && isHueMethod(hueTok) && hueWord === 'hue'
  if (hasHueMethod) {
    if (spaceTok !== 'hsl' && spaceTok !== 'oklch') {
      return {
        ok: false,
        reason: `a hue interpolation method ("${hueTok} hue") is only valid for a polar space (hsl/oklch), got "${spaceTok}"`,
      }
    }
    hue = hueTok as HueInterpolationMethod
    consumed = 4
  }
  const remaining = [...tokens.slice(0, inIdx), ...tokens.slice(inIdx + consumed)]
  return { ok: true, tokens: remaining, interpolation: { space: spaceTok, hue } }
}

function parseHead(
  headPart: string | null,
  kind: GradientKind,
): { ok: true; value: ParsedHead } | { ok: false; reason: string } {
  const defaults: ParsedHead = {
    direction: { type: 'angle', deg: 180 },
    conicAngle: 0,
    center: { x: 50, y: 50 },
    shape: 'ellipse',
    size: 'farthest-corner',
    interpolation: null,
  }
  if (headPart === null) return { ok: true, value: defaults }

  const extracted = extractInterpolation(splitTopLevelWhitespace(headPart))
  if (!extracted.ok) return extracted
  const tokens = extracted.tokens
  const interpolation = extracted.interpolation

  if (kind === 'linear') {
    if (tokens.length === 0) return { ok: true, value: { ...defaults, interpolation } }
    if (tokens.length === 1) {
      const deg = parseAngleToken(tokens[0]!)
      if (deg !== null)
        return {
          ok: true,
          value: { ...defaults, direction: { type: 'angle', deg }, interpolation },
        }
    }
    if (tokens[0]?.toLowerCase() === 'to') {
      const direction = parseSideOrCorner(tokens.slice(1))
      if (direction === null) {
        return {
          ok: false,
          reason: `unrecognized side-or-corner "to ${tokens.slice(1).join(' ')}"`,
        }
      }
      return { ok: true, value: { ...defaults, direction, interpolation } }
    }
    return { ok: false, reason: `unrecognized linear-gradient head "${tokens.join(' ')}"` }
  }

  if (kind === 'radial') {
    let shape: RadialShape = 'ellipse'
    let size: RadialSize = 'farthest-corner'
    let center: GradientCenter = { x: 50, y: 50 }
    let i = 0
    while (i < tokens.length && tokens[i]!.toLowerCase() !== 'at') {
      const tok = tokens[i]!.toLowerCase()
      if (tok === 'circle' || tok === 'ellipse') {
        shape = tok
        i++
        continue
      }
      if (isRadialSize(tok)) {
        size = tok
        i++
        continue
      }
      return {
        ok: false,
        reason:
          `radial-gradient does not support an explicit size length ("${tokens[i]}") — ` +
          'only closest-side/closest-corner/farthest-side/farthest-corner are supported',
      }
    }
    if (tokens[i]?.toLowerCase() === 'at') {
      const pos = parsePosition(tokens.slice(i + 1))
      if (!pos.ok) return pos
      center = pos.value
    } else if (i < tokens.length) {
      return { ok: false, reason: `unrecognized radial-gradient head "${tokens.join(' ')}"` }
    }
    return { ok: true, value: { ...defaults, center, shape, size, interpolation } }
  }

  // conic
  let conicAngle = 0
  let center: GradientCenter = { x: 50, y: 50 }
  let i = 0
  if (tokens[i]?.toLowerCase() === 'from') {
    const a = parseAngleToken(tokens[i + 1] ?? '')
    if (a === null) return { ok: false, reason: `invalid angle "${tokens[i + 1] ?? ''}"` }
    conicAngle = a
    i += 2
  }
  if (tokens[i]?.toLowerCase() === 'at') {
    const pos = parsePosition(tokens.slice(i + 1))
    if (!pos.ok) return pos
    center = pos.value
  } else if (i < tokens.length) {
    return { ok: false, reason: `unrecognized conic-gradient head "${tokens.join(' ')}"` }
  }
  return { ok: true, value: { ...defaults, conicAngle, center, interpolation } }
}

interface RawStop {
  color: PickerColor
  alpha: number
  position: number | null
}

/** The CSS gradient stop auto-positioning algorithm (CSS Images 4 §3.5): the
 * first/last unspecified positions default to 0%/100%, an unspecified run
 * between two specified stops is spaced evenly, and the result is clamped
 * non-decreasing (a stop may never render "before" the stop ahead of it). */
function fillPositions(raw: readonly RawStop[]): Array<{
  color: PickerColor
  alpha: number
  position: number
}> {
  const n = raw.length
  const positions: Array<number | null> = raw.map((r) => r.position)
  if (positions[0] === null) positions[0] = 0
  if (positions[n - 1] === null) positions[n - 1] = 100

  let i = 0
  while (i < n) {
    if (positions[i] !== null) {
      i++
      continue
    }
    let j = i
    while (positions[j] === null) j++
    const start = positions[i - 1]!
    const end = positions[j]!
    const count = j - i + 1
    for (let k = i; k < j; k++) {
      const t = (k - (i - 1)) / count
      positions[k] = start + (end - start) * t
    }
    i = j
  }

  let max = -Infinity
  const resolved = positions.map((p) => {
    const v = Math.max(p as number, max)
    max = v
    return v
  })

  return raw.map((r, idx) => ({ color: r.color, alpha: r.alpha, position: resolved[idx]! }))
}

/** Every named `CssColor` numeric field, generically — used to reject a
 * `none` component (finding #2c): `PickerColor` has no way to STORE `none`
 * (every field is a required `number`), so silently resolving one (as
 * `resolveNone` does everywhere ELSE in this module, for a value already
 * safely OUTSIDE interpolation) would misrepresent a color the user did not
 * write — an explicit `none` hue in particular is not "hue zero", it means
 * "take the other stop's hue during interpolation", which a coerced `0`
 * gets exactly backwards for. */
function noneComponentName(c: CssColor): string | null {
  const fields: Array<[string, number | null]> =
    c.space === 'srgb' || c.space === 'srgb-linear'
      ? [
          ['r', c.r],
          ['g', c.g],
          ['b', c.b],
          ['alpha', c.alpha],
        ]
      : c.space === 'hsl'
        ? [
            ['h', c.h],
            ['s', c.s],
            ['l', c.l],
            ['alpha', c.alpha],
          ]
        : c.space === 'oklab'
          ? [
              ['l', c.l],
              ['a', c.a],
              ['b', c.b],
              ['alpha', c.alpha],
            ]
          : [
              ['l', c.l],
              ['c', c.c],
              ['h', c.h],
              ['alpha', c.alpha],
            ]
  const found = fields.find(([, v]) => v === null)
  return found ? found[0] : null
}

function parseStopList(stopParts: readonly string[]):
  | { ok: true; value: Array<{ color: PickerColor; alpha: number; position: number }> }
  | {
      ok: false
      reason: string
    } {
  const raw: RawStop[] = []
  for (const part of stopParts) {
    const tokens = splitTopLevelWhitespace(part)
    if (tokens.length === 0) return { ok: false, reason: 'empty color stop' }
    const parsedColor = parseCssColor(tokens[0]!)
    if (!parsedColor) {
      return {
        ok: false,
        reason: `color hints are not supported, and "${part}" is not a recognized color`,
      }
    }
    const noneField = noneComponentName(parsedColor)
    if (noneField !== null) {
      return {
        ok: false,
        reason:
          `"none" components are not supported in a gradient stop — "${tokens[0]}" has ` +
          `"none" for its ${noneField} component`,
      }
    }
    const model: ColorModel =
      parsedColor.space === 'oklch' || parsedColor.space === 'oklab' ? 'oklch' : 'hsv'
    // Infinity: parseGradient is a PURE function with no live maxChroma to
    // clamp against — never clip here (finding #2c); the caller (`init`/
    // `setGradient`) RAISES its own maxChroma to fit afterward.
    const { color, alpha } = cssColorToPickerColor(parsedColor, model, Infinity)

    const posTokens = tokens.slice(1)
    if (posTokens.length > 2) {
      return { ok: false, reason: `too many position values on stop "${part}"` }
    }
    const positions: number[] = []
    for (const pt of posTokens) {
      if (!pt.endsWith('%')) {
        return {
          ok: false,
          reason: `only percentage stop positions are supported, got "${pt}" in "${part}"`,
        }
      }
      const n = Number(pt.slice(0, -1))
      if (!Number.isFinite(n)) return { ok: false, reason: `invalid stop position "${pt}"` }
      if (n < 0 || n > 100) {
        return {
          ok: false,
          reason: `stop position "${pt}" is outside 0%-100% (gradient-picker's stop domain is always one cycle)`,
        }
      }
      positions.push(n)
    }
    if (positions.length === 0) raw.push({ color, alpha, position: null })
    else if (positions.length === 1) raw.push({ color, alpha, position: positions[0]! })
    else {
      // A double-position stop is shorthand for two adjacent same-color stops.
      raw.push({ color, alpha, position: positions[0]! })
      raw.push({ color, alpha, position: positions[1]! })
    }
  }
  if (raw.length < 2) return { ok: false, reason: 'a gradient needs at least two color stops' }
  return { ok: true, value: fillPositions(raw) }
}

/** Whether a stop's color TOKEN uses one of CSS's legacy syntaxes (hex,
 * `rgb()`/`rgba()`/`hsl()`/`hsla()`/`hwb()`, a bare named color/
 * `transparent`) rather than a modern one (`oklab()`, `oklch()`, `lab()`,
 * `lch()`, `color()`) — the classifier `parseGradient` uses to pick the
 * omitted-`in` default (finding #2a). Classifies by SYNTAX, not the
 * resolved `CssColor` space: an author who wrote `oklch(...)` opted into
 * Oklab-by-default even where the color happens to be representable as
 * legacy sRGB. */
function isLegacyColorToken(token: string): boolean {
  if (/^(#|rgba?\(|hsla?\(|hwb\()/i.test(token)) return true
  if (!token.includes('(')) return true // a bare named color / `transparent`
  return false
}

/**
 * Parse a CSS `<gradient>` (`linear-gradient()`/`radial-gradient()`/
 * `conic-gradient()`, `repeating-` included) into this component's shape.
 * Accepts: angles in `deg`/`grad`/`rad`/`turn`, `to <side-or-corner>`
 * (stored as a keyword direction — see `GradientDirection`), `at
 * <position>` (percentages + `left`/`center`/`right`/`top`/`bottom`),
 * radial shape/size keywords, `in <space> [<hue> hue]` (omitted resolves to
 * `srgb` when every stop is a legacy color, `oklab` otherwise — CSS Images
 * 4), 0/1/2 stop positions (a 2-position stop expands to two stops) with
 * missing positions filled per the CSS auto-positioning algorithm, and any
 * color `parseCssColor` accepts.
 *
 * Explicitly REJECTS (with a `reason`, never silently dropping/clamping
 * data): length-based stop positions (only `%`), a stop position outside
 * 0%-100%, an explicit radial size LENGTH (`circle 40px` — only the four
 * keyword extents), a length-based `at` position, a color hint (a bare
 * percentage in the stop list with no color), and any color with a `none`
 * component (`PickerColor` cannot store one — see `noneComponentName`).
 * Chroma beyond a live instance's `maxChroma` is NOT rejected here (this
 * function has no live instance to compare against) — `init`/`setGradient`
 * raise their own `maxChroma` to fit instead.
 *
 * `parseGradient(toCss(s))` reproduces `s` modulo stop ids — see the
 * property test.
 */
export function parseGradient(css: string): ParseGradientResult {
  const input = css.trim()
  const m = GRADIENT_HEAD_RE.exec(input)
  if (!m) return { ok: false, reason: 'not a linear-/radial-/conic-gradient() function' }
  const repeating = m[1] !== undefined
  const kind = m[2]!.toLowerCase() as GradientKind
  const inner = m[3]!
  if (!isBalanced(inner)) return { ok: false, reason: 'unbalanced parentheses' }

  const parts = splitTopLevelCommas(inner)
  if (parts.length < 1 || parts[0] === '') return { ok: false, reason: 'empty gradient' }

  const firstToken = splitTopLevelWhitespace(parts[0]!)[0] ?? ''
  const looksLikeHead = parseCssColor(firstToken) === null
  const headPart = looksLikeHead ? parts[0]! : null
  const stopParts = looksLikeHead ? parts.slice(1) : parts

  const headResult = parseHead(headPart, kind)
  if (!headResult.ok) return headResult

  const stopsResult = parseStopList(stopParts)
  if (!stopsResult.ok) return stopsResult

  const allLegacy = stopParts.every((part) => {
    const token = splitTopLevelWhitespace(part)[0] ?? ''
    return isLegacyColorToken(token)
  })
  const interpolation: GradientInterpolation = headResult.value.interpolation ?? {
    space: allLegacy ? 'srgb' : 'oklab',
    hue: 'shorter',
  }

  return {
    ok: true,
    value: {
      kind,
      repeating,
      direction: headResult.value.direction,
      conicAngle: headResult.value.conicAngle,
      center: headResult.value.center,
      shape: headResult.value.shape,
      size: headResult.value.size,
      interpolation,
      stops: stopsResult.value,
    },
  }
}

// ── Part bag ─────────────────────────────────────────────────────────────────

function physicalPercent(rect: { left: number; width: number }, clientX: number): number {
  if (rect.width === 0) return 0
  return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)
}

/** Physical <-> logical position mirror for the track, under `dir: 'rtl'` —
 * the same single-mirror shape `slider.ts`'s `horizontalPositionPercent`
 * uses, and self-inverse (feeding it its own output returns the input),
 * which is what lets both the pointer-to-position and position-to-`left%`
 * directions share one function. `gradient-picker`'s track is a plain `div`
 * the CONSUMER builds (unlike `color-picker`'s hue slider, a native
 * `<input type="range">` the BROWSER mirrors for free under `dir="rtl"`), so
 * — like `slider`/`angle-slider` — it owns its own RTL mapping rather than
 * relying on one.
 */
function mirrorForDir(percent: number, dir: 'ltr' | 'rtl'): number {
  return dir === 'rtl' ? 100 - percent : percent
}

function positionFromClientX(
  rect: { left: number; width: number },
  clientX: number,
  dir: 'ltr' | 'rtl',
): number {
  return mirrorForDir(physicalPercent(rect, clientX), dir)
}

function largestGapMidpoint(stops: readonly GradientStop[]): number {
  if (stops.length === 0) return 50
  if (stops.length === 1) return stops[0]!.position < 50 ? 100 : 0
  let bestGap = -1
  let bestMid = 50
  for (let i = 0; i < stops.length - 1; i++) {
    const gap = stops[i + 1]!.position - stops[i]!.position
    if (gap > bestGap) {
      bestGap = gap
      bestMid = (stops[i]!.position + stops[i + 1]!.position) / 2
    }
  }
  return bestMid
}

export interface GradientStopParts {
  id: string
  role: 'slider'
  'aria-label': string
  'aria-valuemin': 0
  'aria-valuemax': 100
  'aria-valuenow': Signal<number>
  'aria-valuetext': Signal<string>
  'aria-disabled': Signal<'true' | undefined>
  /** Every stop is independently tabbable (never -1 while enabled) — the
   * package's existing multi-thumb precedent (`slider.ts`'s `SliderThumbParts`)
   * rather than a roving single-tab-stop composite: APG's roving-tabindex
   * pattern is for ONE composite control with ONE conceptual focus (a
   * toolbar, a listbox); a multi-stop gradient ramp is closer to several
   * independent sliders, which is exactly the case `slider.ts` already
   * chose this way for. Tab therefore visits stops in DOM order, which
   * tracks position order since `each()` renders the reducer's own
   * position-sorted `stops` array. */
  tabindex: Signal<number>
  'data-scope': 'gradient-picker'
  'data-part': 'stop'
  'data-value': string
  'data-selected': Signal<'' | undefined>
  style: Signal<string>
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerCancel: (e: PointerEvent) => void
  onLostPointerCapture: (e: PointerEvent) => void
  onFocus: (e: FocusEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export type ToggleItemPart = 'kind-toggle' | 'shape-option' | 'size-option'

export interface ToggleItemParts {
  type: 'button'
  'aria-label': string
  'aria-pressed': Signal<boolean>
  'data-scope': 'gradient-picker'
  'data-part': ToggleItemPart
  'data-value': string
  'data-state': Signal<'on' | 'off'>
  disabled: Signal<boolean>
  onClick: (e: MouseEvent) => void
}

export interface GradientPickerParts {
  root: {
    'data-scope': 'gradient-picker'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
    'data-kind': Signal<GradientKind>
    'data-repeating': Signal<'' | undefined>
  }
  preview: {
    'data-scope': 'gradient-picker'
    'data-part': 'preview'
    'aria-hidden': 'true'
    style: Signal<string>
  }
  /** The horizontal stop ramp: a plain `in <space>` linear ramp of the SAME
   * stop list `toCss` serializes (finding #3 — one shared builder, never two
   * strings that can drift), including the hue method and the
   * `repeating-`/rtl-mirrored angle so what the track PAINTS matches
   * `colorAt` at every position, regardless of `state.kind`. Pointerdown on
   * the bare track (not on an existing stop, which calls
   * `stopPropagation()`) adds a new stop at that position and starts
   * dragging it immediately. */
  track: {
    'data-scope': 'gradient-picker'
    'data-part': 'track'
    style: Signal<string>
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
    onLostPointerCapture: (e: PointerEvent) => void
  }
  stop: (id: string) => GradientStopParts
  addStopButton: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'gradient-picker'
    'data-part': 'add-stop-button'
    onClick: (e: MouseEvent) => void
  }
  removeStopButton: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'gradient-picker'
    'data-part': 'remove-stop-button'
    onClick: (e: MouseEvent) => void
  }
  kindToggle: (kind: GradientKind) => ToggleItemParts
  repeatingToggle: {
    type: 'button'
    'aria-label': string
    'aria-pressed': Signal<boolean>
    disabled: Signal<boolean>
    'data-scope': 'gradient-picker'
    'data-part': 'repeating-toggle'
    'data-state': Signal<'on' | 'off'>
    onClick: (e: MouseEvent) => void
  }
  angleInput: {
    type: 'range'
    min: 0
    max: 360
    step: 1
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'gradient-picker'
    'data-part': 'angle-input'
    onInput: (e: Event) => void
  }
  centerArea: {
    'data-scope': 'gradient-picker'
    'data-part': 'center-area'
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
    onLostPointerCapture: (e: PointerEvent) => void
  }
  centerThumb: {
    role: 'slider'
    'aria-label': string
    'aria-valuemin': 0
    'aria-valuemax': 100
    'aria-valuenow': Signal<number>
    'aria-valuetext': Signal<string>
    'aria-disabled': Signal<'true' | undefined>
    tabindex: Signal<number>
    'data-scope': 'gradient-picker'
    'data-part': 'center-thumb'
    style: Signal<string>
    onKeyDown: (e: KeyboardEvent) => void
  }
  shapeOption: (shape: RadialShape) => ToggleItemParts
  sizeOption: (size: RadialSize) => ToggleItemParts
  interpolationSpaceSelect: {
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<InterpolationSpace>
    'data-scope': 'gradient-picker'
    'data-part': 'interpolation-space-select'
    onInput: (e: Event) => void
  }
  interpolationHueSelect: {
    'aria-label': string
    /** Disabled when the whole picker is disabled, OR the current space has
     * no hue (only `hsl`/`oklch` do). */
    disabled: Signal<boolean>
    value: Signal<HueInterpolationMethod>
    'data-scope': 'gradient-picker'
    'data-part': 'interpolation-hue-select'
    onInput: (e: Event) => void
  }
  reverseButton: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'gradient-picker'
    'data-part': 'reverse-button'
    onClick: (e: MouseEvent) => void
  }
  distributeButton: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'gradient-picker'
    'data-part': 'distribute-button'
    onClick: (e: MouseEvent) => void
  }
  /** The draft, NOT the committed value, while editing — see
   * `GradientPickerState.cssDraft`. Commits on `change`/Enter, never on
   * every keystroke, so the caret never jumps mid-edit; `aria-invalid` +
   * `aria-describedby` (pointing at `cssError`'s `id`) publish validity. */
  cssInput: {
    type: 'text'
    autocomplete: 'off'
    spellcheck: 'false'
    'aria-label': string
    'aria-invalid': Signal<'true' | undefined>
    'aria-describedby': Signal<string | undefined>
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'gradient-picker'
    'data-part': 'css-input'
    onInput: (e: Event) => void
    onChange: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  /** The describable error region `cssInput`'s `aria-describedby` points at
   * — empty/hidden text when there is no error, matching `form-field`'s
   * `errorText` convention (attributes + a sibling `visible`/`message`
   * rather than folding non-attribute content into the same bag). */
  cssError: {
    id: string
    role: 'alert'
    'data-scope': 'gradient-picker'
    'data-part': 'css-error'
    visible: Signal<boolean>
    message: Signal<string>
  }
  /**
   * The embedded `color-picker`'s FULL part bag, connected over the DERIVED
   * `pickerStateOf(state)` — eyedropper, OKLCH canvas, model toggle, every
   * slider, all included with zero glue. Messages are wrapped as
   * `{ type: 'picker'; msg }` via `wrapChildSend` (which also tags the
   * dispatcher `__lluiVariants: ['picker']`, so every handler `color-picker`
   * builds from it reports the truthful PARENT-visible type) and unwrapped
   * by this component's `update()` — see the module doc comment.
   */
  picker: ColorPickerParts
}

export interface ConnectOptions {
  id: string
  trackLabel?: string
  addStopLabel?: string
  removeStopLabel?: string
  kindLabels?: Partial<Record<GradientKind, string>>
  repeatingLabel?: string
  angleLabel?: string
  centerLabel?: string
  shapeLabels?: Partial<Record<RadialShape, string>>
  sizeLabels?: Partial<Record<RadialSize, string>>
  interpolationSpaceLabel?: string
  interpolationHueLabel?: string
  reverseLabel?: string
  distributeLabel?: string
  cssLabel?: string
  /** Fine keyboard step for a stop / the center thumb (percent units).
   * Default 1. */
  step?: number
  /** Coarse keyboard step when Shift is held. Default 10. */
  coarseStep?: number
  /** Forwarded to the embedded `color-picker`'s own `connect()` (labels,
   * area-thumb step/coarseStep). */
  pickerOptions?: ColorPickerConnectOptions
}

export function connect(
  state: Signal<GradientPickerState>,
  send: Send<GradientPickerMsg>,
  opts: ConnectOptions,
): GradientPickerParts {
  const locale = gradientPickerLocale()
  const fine = opts.step ?? 1
  const coarse = opts.coarseStep ?? 10
  const base = opts.id
  const cssErrorId = `${base}:css-error`

  let pendingTrackDragId: string | null = null
  const trackDrag = pointerDragHandlers({
    isDisabled: () => state.peek().disabled,
    onDragStart: (e) => {
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      const position = positionFromClientX(rect, e.clientX, state.peek().dir)
      const id = `s${state.peek().nextId}`
      send({ type: 'addStop', position })
      pendingTrackDragId = id
      ;(e.currentTarget as HTMLElement)
        .querySelector<HTMLElement>(`[data-part="stop"][data-value="${id}"]`)
        ?.focus()
    },
    onDrag: (e) => {
      if (pendingTrackDragId === null) return
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      const position = positionFromClientX(rect, e.clientX, state.peek().dir)
      send({ type: 'moveStop', id: pendingTrackDragId, position })
    },
    onDragEnd: () => {
      pendingTrackDragId = null
    },
  })

  const centerDrag = pointerDragHandlers({
    isDisabled: () => state.peek().disabled,
    onDragStart: (e) => {
      ;(e.currentTarget as HTMLElement)
        .querySelector<HTMLElement>('[data-part="center-thumb"]')
        ?.focus()
    },
    onDrag: (e) => {
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      const x = rect.width === 0 ? 0 : clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100)
      const y = rect.height === 0 ? 0 : clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100)
      send({ type: 'setCenter', x, y })
    },
  })

  const stopCount = (s: GradientPickerState): number => s.stops.length

  const pickerSend = wrapChildSend<GradientPickerMsg, ColorPickerMsg>(
    send,
    (m) => ({ type: 'picker', msg: m }),
    ['picker'],
  )
  const picker = colorPickerConnect(state.map(pickerStateOf), pickerSend, opts.pickerOptions)

  const toggleItem = (
    part: ToggleItemPart,
    value: string,
    active: (s: GradientPickerState) => boolean,
    label: string,
    dispatch: () => void,
    dispatchedVariants: readonly GradientPickerMsg['type'][],
  ): ToggleItemParts => ({
    type: 'button',
    'aria-label': label,
    'aria-pressed': state.map(active),
    'data-scope': 'gradient-picker',
    'data-part': part,
    'data-value': value,
    'data-state': state.map((s) => (active(s) ? 'on' : 'off')),
    disabled: state.map((s) => s.disabled),
    onClick: tagSend(send, dispatchedVariants, () => dispatch()),
  })

  return {
    root: {
      'data-scope': 'gradient-picker',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      'data-kind': state.map((s) => s.kind),
      'data-repeating': state.map((s) => (s.repeating ? '' : undefined)),
    },
    preview: {
      'data-scope': 'gradient-picker',
      'data-part': 'preview',
      'aria-hidden': 'true',
      style: state.map((s) => `background:${toCss(s)};`),
    },
    track: {
      'data-scope': 'gradient-picker',
      'data-part': 'track',
      style: state.map((s) => {
        const stopList = gradientStopListCss(s.stops)
        const interp = interpolationHead(s.interpolation)
        const prefix = s.repeating ? 'repeating-' : ''
        const angleDeg = s.dir === 'rtl' ? 270 : 90
        return `background: ${prefix}linear-gradient(${angleDeg}deg ${interp}, ${stopList});`
      }),
      onPointerDown: tagSend(send, ['addStop', 'moveStop'], trackDrag.onPointerDown),
      onPointerMove: tagSend(send, ['moveStop'], trackDrag.onPointerMove),
      onPointerUp: tagSend(send, [], trackDrag.onPointerUp),
      onPointerCancel: tagSend(send, [], trackDrag.onPointerCancel),
      onLostPointerCapture: tagSend(send, [], trackDrag.onLostPointerCapture),
    },
    stop: (id: string): GradientStopParts => {
      const drag = pointerDragHandlers({
        isDisabled: () => state.peek().disabled,
        onDrag: (e) => {
          const track = (e.currentTarget as Element).closest('[data-part="track"]')
          if (!track) return
          const rect = track.getBoundingClientRect()
          const position = positionFromClientX(rect, e.clientX, state.peek().dir)
          send({ type: 'moveStop', id, position })
        },
      })
      const stopOf = (s: GradientPickerState): GradientStop | undefined => findStop(s, id)
      return {
        id: `${base}:stop:${id}`,
        role: 'slider',
        'aria-label': opts.trackLabel ?? locale.track,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': state.map((s) => stopOf(s)?.position ?? 0),
        'aria-valuetext': state.map((s) => {
          const idx = s.stops.findIndex((st) => st.id === id)
          const st = s.stops[idx]
          if (!st) return ''
          return locale.stop(idx + 1, s.stops.length, formatStopColor(st), st.position)
        }),
        'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
        tabindex: state.map((s) => (s.disabled ? -1 : 0)),
        'data-scope': 'gradient-picker',
        'data-part': 'stop',
        'data-value': id,
        'data-selected': state.map((s) => (s.selectedId === id ? '' : undefined)),
        style: state.map((s) => {
          const st = stopOf(s)
          if (!st) return 'display:none;'
          const left = mirrorForDir(st.position, s.dir)
          return `left:${left}%;background-color:${formatStopColor(st)};`
        }),
        onPointerDown: tagSend(send, ['selectStop', 'moveStop'], (e: PointerEvent) => {
          e.stopPropagation()
          send({ type: 'selectStop', id })
          drag.onPointerDown(e)
        }),
        onPointerMove: tagSend(send, ['moveStop'], drag.onPointerMove),
        onPointerUp: tagSend(send, [], drag.onPointerUp),
        onPointerCancel: tagSend(send, [], drag.onPointerCancel),
        onLostPointerCapture: tagSend(send, [], drag.onLostPointerCapture),
        onFocus: tagSend(send, ['selectStop'], () => send({ type: 'selectStop', id })),
        onKeyDown: tagSend(send, ['nudgeStop', 'moveStop', 'removeStop'], (e: KeyboardEvent) => {
          const step = e.shiftKey ? coarse : fine
          // APG horizontal slider: ArrowRight/ArrowUp increase, ArrowLeft/
          // ArrowDown decrease; only the horizontal pair flips under RTL
          // (`flipArrow` — vertical arrows are direction-agnostic).
          const key = flipArrow(e.key, state.peek().dir)
          switch (key) {
            case 'ArrowRight':
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'nudgeStop', id, delta: step })
              return
            case 'ArrowLeft':
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'nudgeStop', id, delta: -step })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'moveStop', id, position: 0 })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'moveStop', id, position: 100 })
              return
            case 'PageUp':
              e.preventDefault()
              send({ type: 'nudgeStop', id, delta: coarse })
              return
            case 'PageDown':
              e.preventDefault()
              send({ type: 'nudgeStop', id, delta: -coarse })
              return
            case 'Delete':
            case 'Backspace':
              e.preventDefault()
              send({ type: 'removeStop', id })
              return
          }
        }),
      }
    },
    addStopButton: {
      type: 'button',
      'aria-label': opts.addStopLabel ?? locale.addStop,
      disabled: state.map(
        (s) => s.disabled || (s.maxStops !== undefined && stopCount(s) >= s.maxStops),
      ),
      'data-scope': 'gradient-picker',
      'data-part': 'add-stop-button',
      onClick: tagSend(send, ['addStop'], () => {
        const s = state.peek()
        send({ type: 'addStop', position: largestGapMidpoint(s.stops) })
      }),
    },
    removeStopButton: {
      type: 'button',
      'aria-label': opts.removeStopLabel ?? locale.removeStop,
      disabled: state.map((s) => s.disabled || stopCount(s) <= s.minStops),
      'data-scope': 'gradient-picker',
      'data-part': 'remove-stop-button',
      onClick: tagSend(send, ['removeStop'], () => {
        send({ type: 'removeStop', id: state.peek().selectedId })
      }),
    },
    kindToggle: (kind: GradientKind): ToggleItemParts =>
      toggleItem(
        'kind-toggle',
        kind,
        (s) => s.kind === kind,
        opts.kindLabels?.[kind] ?? locale[kind],
        () => send({ type: 'setKind', kind }),
        ['setKind'],
      ),
    repeatingToggle: {
      type: 'button',
      'aria-label': opts.repeatingLabel ?? locale.repeating,
      'aria-pressed': state.map((s) => s.repeating),
      disabled: state.map((s) => s.disabled),
      'data-scope': 'gradient-picker',
      'data-part': 'repeating-toggle',
      'data-state': state.map((s) => (s.repeating ? 'on' : 'off')),
      onClick: tagSend(send, ['setRepeating'], () => {
        send({ type: 'setRepeating', repeating: !state.peek().repeating })
      }),
    },
    angleInput: {
      type: 'range',
      min: 0,
      max: 360,
      step: 1,
      'aria-label': opts.angleLabel ?? locale.angle,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) =>
        String(Math.round(s.kind === 'conic' ? s.conicAngle : directionAngleDeg(s.direction))),
      ),
      'data-scope': 'gradient-picker',
      'data-part': 'angle-input',
      onInput: tagSend(send, ['setAngle'], (e) =>
        send({ type: 'setAngle', angle: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    centerArea: {
      'data-scope': 'gradient-picker',
      'data-part': 'center-area',
      onPointerDown: tagSend(send, ['setCenter'], centerDrag.onPointerDown),
      onPointerMove: tagSend(send, ['setCenter'], centerDrag.onPointerMove),
      onPointerUp: tagSend(send, [], centerDrag.onPointerUp),
      onPointerCancel: tagSend(send, [], centerDrag.onPointerCancel),
      onLostPointerCapture: tagSend(send, [], centerDrag.onLostPointerCapture),
    },
    centerThumb: {
      role: 'slider',
      'aria-label': opts.centerLabel ?? locale.center,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': state.map((s) => s.center.x),
      'aria-valuetext': state.map((s) => `${Math.round(s.center.x)}%, ${Math.round(s.center.y)}%`),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      tabindex: state.map((s) => (s.disabled ? -1 : 0)),
      'data-scope': 'gradient-picker',
      'data-part': 'center-thumb',
      style: state.map((s) => `left:${s.center.x}%;top:${s.center.y}%;`),
      onKeyDown: tagSend(send, ['setCenter'], (e) => {
        const step = e.shiftKey ? coarse : fine
        const dir = state.peek().dir
        const key = flipArrow(e.key, dir)
        const current = state.peek().center
        const set = (x: number, y: number): void =>
          send({ type: 'setCenter', x: clamp(x, 0, 100), y: clamp(y, 0, 100) })
        switch (key) {
          case 'ArrowRight':
            e.preventDefault()
            set(current.x + step, current.y)
            return
          case 'ArrowLeft':
            e.preventDefault()
            set(current.x - step, current.y)
            return
          case 'ArrowUp':
            e.preventDefault()
            set(current.x, current.y - step)
            return
          case 'ArrowDown':
            e.preventDefault()
            set(current.x, current.y + step)
            return
          case 'Home':
            e.preventDefault()
            set(0, 0)
            return
          case 'End':
            e.preventDefault()
            set(100, 100)
            return
        }
      }),
    },
    shapeOption: (shape: RadialShape): ToggleItemParts =>
      toggleItem(
        'shape-option',
        shape,
        (s) => s.shape === shape,
        opts.shapeLabels?.[shape] ??
          (shape === 'circle' ? locale.shapeCircle : locale.shapeEllipse),
        () => send({ type: 'setShape', shape }),
        ['setShape'],
      ),
    sizeOption: (size: RadialSize): ToggleItemParts =>
      toggleItem(
        'size-option',
        size,
        (s) => s.size === size,
        opts.sizeLabels?.[size] ?? SIZE_LOCALE_KEY[size](locale),
        () => send({ type: 'setSize', size }),
        ['setSize'],
      ),
    interpolationSpaceSelect: {
      'aria-label': opts.interpolationSpaceLabel ?? locale.interpolationSpace,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => s.interpolation.space),
      'data-scope': 'gradient-picker',
      'data-part': 'interpolation-space-select',
      onInput: tagSend(send, ['setInterpolation'], (e) => {
        const space = (e.target as HTMLSelectElement).value
        if (!isInterpolationSpace(space)) return
        send({ type: 'setInterpolation', space, hue: state.peek().interpolation.hue })
      }),
    },
    interpolationHueSelect: {
      'aria-label': opts.interpolationHueLabel ?? locale.interpolationHue,
      disabled: state.map(
        (s) => s.disabled || (s.interpolation.space !== 'hsl' && s.interpolation.space !== 'oklch'),
      ),
      value: state.map((s) => s.interpolation.hue),
      'data-scope': 'gradient-picker',
      'data-part': 'interpolation-hue-select',
      onInput: tagSend(send, ['setInterpolation'], (e) => {
        const hue = (e.target as HTMLSelectElement).value
        if (!isHueMethod(hue)) return
        send({ type: 'setInterpolation', space: state.peek().interpolation.space, hue })
      }),
    },
    reverseButton: {
      type: 'button',
      'aria-label': opts.reverseLabel ?? locale.reverse,
      disabled: state.map((s) => s.disabled),
      'data-scope': 'gradient-picker',
      'data-part': 'reverse-button',
      onClick: tagSend(send, ['reverse'], () => send({ type: 'reverse' })),
    },
    distributeButton: {
      type: 'button',
      'aria-label': opts.distributeLabel ?? locale.distribute,
      disabled: state.map((s) => s.disabled || s.stops.length <= 1),
      'data-scope': 'gradient-picker',
      'data-part': 'distribute-button',
      onClick: tagSend(send, ['distribute'], () => send({ type: 'distribute' })),
    },
    cssInput: {
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': opts.cssLabel ?? locale.css,
      'aria-invalid': state.map((s) => (s.cssError !== null ? 'true' : undefined)),
      'aria-describedby': state.map((s) => (s.cssError !== null ? cssErrorId : undefined)),
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => s.cssDraft ?? toCss(s)),
      'data-scope': 'gradient-picker',
      'data-part': 'css-input',
      // Typing only updates the DRAFT — never re-parses on every keystroke,
      // so the caret can't jump (finding #6).
      onInput: tagSend(send, ['setGradientDraft'], (e) =>
        send({ type: 'setGradientDraft', value: (e.target as HTMLInputElement).value }),
      ),
      // Commits on blur/change...
      onChange: tagSend(send, ['setGradient'], (e) =>
        send({ type: 'setGradient', css: (e.target as HTMLInputElement).value }),
      ),
      // ...or Enter, without waiting for blur.
      onKeyDown: tagSend(send, ['setGradient'], (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        send({ type: 'setGradient', css: (e.target as HTMLInputElement).value })
      }),
    },
    cssError: {
      id: cssErrorId,
      role: 'alert',
      'data-scope': 'gradient-picker',
      'data-part': 'css-error',
      visible: state.map((s) => s.cssError !== null),
      message: state.map((s) => (s.cssError !== null ? locale.cssError(s.cssError) : '')),
    },
    picker,
  }
}

const SIZE_LOCALE_KEY: Record<RadialSize, (l: ReturnType<typeof gradientPickerLocale>) => string> =
  {
    'closest-side': (l) => l.sizeClosestSide,
    'closest-corner': (l) => l.sizeClosestCorner,
    'farthest-side': (l) => l.sizeFarthestSide,
    'farthest-corner': (l) => l.sizeFarthestCorner,
  }

export const gradientPicker = {
  init,
  update,
  connect,
  toCss,
  colorAt,
  parseGradient,
  pickerStateOf,
}
