import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { gradientPickerLocale } from '../locale/gradient-picker.js'
import { allFiniteNumbers, clamp, finiteOrDefault, positiveFinite } from '../utils/number.js'
import { pointerDragHandlers } from '../utils/pointer-drag.js'
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
 * ## The embedded picker is DERIVED, never stored
 *
 * There is exactly one color store per stop (`GradientStop.color`, the same
 * `PickerColor` union `color-picker` itself uses) and exactly one place that
 * projects it into a live `ColorPickerState`: {@link pickerStateOf}. Editing
 * the picker sends `{ type: 'picker'; msg }`; `update()` runs
 * `colorPicker.update` on that DERIVED state and writes the result's
 * `color`/`alpha` back onto the SELECTED stop only (plus `state.model`, kept
 * in sync whenever the picker's own `setModel` fires — see `pickerStateOf`'s
 * doc comment). This is what keeps a gray stop's hue alive across a model
 * switch: the stop never round-trips through a hex string, only through the
 * same HSV<->OKLCH projections `color-picker` already uses to stay lossless.
 *
 * ## The stop-position domain is always one cycle, 0–100
 *
 * `repeating` only changes the CSS `repeating-` prefix (how the SAME 0–100
 * ramp tiles across the painted box) — it never changes what a stop's
 * `position` number means. `colorAt`/`addStop` always read `position` as a
 * percentage of one cycle, matching what {@link toCss}'s stop list expresses,
 * regardless of `repeating`.
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
  /** Degrees. Linear: the gradient's own direction. Conic: the `from` angle. */
  angle: number
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
   * stays pure, so ids can never come from `Math.random()`/`crypto`. */
  nextId: number
  /** Which model the embedded picker edits in. Kept in sync with whatever
   * model a `picker: { msg: { type: 'setModel' } }` last selected — see
   * {@link pickerStateOf}. */
  model: ColorModel
  maxChroma: number
  /** `removeStop` refuses to go below this many stops. Default 2. */
  minStops: number
  /**
   * Upper bound on stop count, or ABSENT for unbounded. Follows the
   * package's UNBOUNDED-CAPABLE idiom (CLAUDE.md #177, `breadcrumbs.
   * maxVisible`): the key is OMITTED rather than holding `null`, so a
   * `JSON.parse(JSON.stringify(state))` round trip is a key-for-key
   * identity. (The brief this component was specified from spelled this
   * field `number | null` — that is the one place this implementation
   * deliberately diverges from it; see the final report.)
   */
  maxStops?: number
  disabled: boolean
  /** Reading direction. Under `rtl`, the track's physical left/right is
   * mirrored — see the module doc comment on why this differs from
   * `color-picker`'s (native-input) hue slider. */
  dir: 'ltr' | 'rtl'
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
  /** @intent("Set the angle in degrees — the linear direction, or the conic `from` angle. Normalized to [0,360)") */
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
  /** @intent("Replace the whole gradient by parsing a CSS gradient string. Invalid input leaves the gradient unchanged") */
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
   * Takes precedence over `stops`/`kind`/… below. Invalid CSS falls back to
   * the `stops`/defaults path below, same as `color-picker`'s `color` option
   * falling back on an unparsable string. */
  css?: string
  /** Explicit initial stops (ignored if `css` parses). Sorted by `position`
   * on init; ids are assigned sequentially in the SORTED order. */
  stops?: GradientStopInit[]
  kind?: GradientKind
  repeating?: boolean
  angle?: number
  center?: Partial<GradientCenter>
  shape?: RadialShape
  size?: RadialSize
  interpolation?: Partial<GradientInterpolation>
  model?: ColorModel
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

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * The default `<color-interpolation-method>` this component assumes when one
 * is not given (a fresh `init()`, or `parseGradient` on a gradient with no
 * explicit `in <space>`): `oklab`, per CSS Color 4/Images 4's resolution that
 * gradient interpolation defaults to Oklab rather than the legacy per-space
 * behavior. Called out explicitly because it is a REASONED decision (matching
 * the current spec text) rather than one measured against a shipped browser
 * in this environment — see the final report.
 */
const DEFAULT_INTERPOLATION: GradientInterpolation = { space: 'oklab', hue: 'shorter' }

const DEFAULT_INIT_STOPS: readonly GradientStopInit[] = [
  { position: 0, color: { model: 'hsv', h: 0, s: 0, v: 0 } },
  { position: 100, color: { model: 'hsv', h: 0, s: 0, v: 100 } },
]

// ── Stop construction / ordering helpers ────────────────────────────────────

function reclampStop(
  stop: { color: PickerColor; alpha: number; position: number },
  maxChroma: number,
): { color: PickerColor; alpha: number; position: number } {
  if (stop.color.model !== 'oklch') return stop
  const css = pickerColorToCssColor(stop.color, stop.alpha)
  const { color, alpha } = cssColorToPickerColor(css, 'oklch', maxChroma)
  return { color, alpha, position: stop.position }
}

function pickerColorOf(
  input: PickerColor | string | undefined,
  maxChroma: number,
): { color: PickerColor; alpha: number | undefined } {
  const fallback: PickerColor = { model: 'hsv', h: 0, s: 0, v: 0 }
  if (input === undefined) return { color: fallback, alpha: undefined }
  if (typeof input !== 'string') return { color: input, alpha: undefined }
  const parsed = parseCssColor(input)
  if (!parsed) return { color: fallback, alpha: undefined }
  const model: ColorModel = parsed.space === 'oklch' || parsed.space === 'oklab' ? 'oklch' : 'hsv'
  return cssColorToPickerColor(parsed, model, maxChroma)
}

function buildStopsFromOptions(
  rawStops: readonly GradientStopInit[],
  maxChroma: number,
  maxStops: number | undefined,
): { stops: GradientStop[]; nextId: number } {
  const capped = maxStops !== undefined ? rawStops.slice(0, maxStops) : rawStops
  const withColors = capped.map((s) => {
    const { color, alpha } = pickerColorOf(s.color, maxChroma)
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
  return { stops, nextId: stops.length + 1 }
}

function buildStopsFromParsed(
  parsedStops: ReadonlyArray<{ color: PickerColor; alpha: number; position: number }>,
  maxChroma: number,
  maxStops: number | undefined,
): { stops: GradientStop[]; nextId: number } {
  const capped = maxStops !== undefined ? parsedStops.slice(0, maxStops) : parsedStops
  const stops = capped.map((s, i) => ({ id: `s${i + 1}`, ...reclampStop(s, maxChroma) }))
  return { stops, nextId: stops.length + 1 }
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

function selectedStop(state: GradientPickerState): GradientStop {
  return findStop(state, state.selectedId) ?? state.stops[0]!
}

// ── init ─────────────────────────────────────────────────────────────────────

export function init(opts: GradientPickerInit = {}): GradientPickerState {
  const maxChroma = positiveFinite(opts.maxChroma) ?? DEFAULT_MAX_CHROMA
  const minStops = Math.max(1, Math.round(finiteOrDefault(opts.minStops, 2)))
  const maxStops = positiveFinite(opts.maxStops)
  const model: ColorModel = opts.model ?? 'hsv'
  const disabled = opts.disabled ?? false
  const dir = opts.dir ?? 'ltr'
  const maxStopsField = maxStops !== undefined ? { maxStops } : {}

  if (opts.css !== undefined) {
    const parsed = parseGradient(opts.css)
    if (parsed.ok) {
      const built = buildStopsFromParsed(parsed.value.stops, maxChroma, maxStops)
      return {
        kind: parsed.value.kind,
        repeating: parsed.value.repeating,
        angle: parsed.value.angle,
        center: parsed.value.center,
        shape: parsed.value.shape,
        size: parsed.value.size,
        interpolation: parsed.value.interpolation,
        stops: built.stops,
        selectedId: built.stops[0]?.id ?? 's1',
        nextId: built.nextId,
        model,
        maxChroma,
        minStops,
        ...maxStopsField,
        disabled,
        dir,
      }
    }
    // Invalid CSS falls through to the explicit-stops / default path, same
    // fallback shape as `colorPicker.init`'s `color` option.
  }

  const built = buildStopsFromOptions(opts.stops ?? DEFAULT_INIT_STOPS, maxChroma, maxStops)

  return {
    kind: opts.kind ?? 'linear',
    repeating: opts.repeating ?? false,
    angle: normalizeAngle(finiteOrDefault(opts.angle, 90)),
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
    stops: built.stops,
    selectedId: built.stops[0]?.id ?? 's1',
    nextId: built.nextId,
    model,
    maxChroma,
    minStops,
    ...maxStopsField,
    disabled,
    dir,
  }
}

// ── pickerStateOf / update ───────────────────────────────────────────────────

/**
 * Build the `ColorPickerState` the embedded picker edits: the SELECTED
 * stop's own color+alpha, projected onto `state.model` (lossless — the same
 * `hsvToOklchPreserving`/`oklchToHsvPreserving` projections `color-picker`
 * itself uses, so a gray stop's hue survives the projection). `state.model`
 * — not each stop's own stored model — decides which model the picker shows,
 * so switching stops never flips the picker's UI out from under the user;
 * `update()`'s `'picker'` case is what keeps a freshly-projected color
 * written back onto the stop, and keeps `state.model` itself in sync when
 * the picker's `setModel` message is the one that arrived.
 */
export function pickerStateOf(state: GradientPickerState): ColorPickerState {
  const stop = selectedStop(state)
  const projected =
    stop.color.model === state.model
      ? stop.color
      : cssColorToPickerColor(
          pickerColorToCssColor(stop.color, stop.alpha),
          state.model,
          state.maxChroma,
        ).color
  return {
    color: projected,
    alpha: stop.alpha,
    disabled: state.disabled,
    maxChroma: state.maxChroma,
    // The embedded picker's eyedropper isn't wired up by gradient-picker
    // (its own review pass, not this lane's) — always "unsupported" so the
    // derived state stays a valid ColorPickerState.
    eyeDropperSupported: false,
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
    case 'setAngle':
      return [{ ...state, angle: normalizeAngle(msg.angle) }, []]
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
    case 'setGradient': {
      const parsed = parseGradient(msg.css)
      if (!parsed.ok) return [state, []]
      const built = buildStopsFromParsed(parsed.value.stops, state.maxChroma, state.maxStops)
      return [
        {
          ...state,
          kind: parsed.value.kind,
          repeating: parsed.value.repeating,
          angle: parsed.value.angle,
          center: parsed.value.center,
          shape: parsed.value.shape,
          size: parsed.value.size,
          interpolation: parsed.value.interpolation,
          stops: built.stops,
          selectedId: built.stops[0]?.id ?? state.selectedId,
          nextId: built.nextId,
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
      const model = msg.msg.type === 'setModel' ? msg.msg.model : state.model
      return [{ ...state, stops, model }, []]
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
      return [{ ...state, dir: msg.dir }, []]
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

function interpolationHead(state: GradientPickerState): string {
  const { space, hue } = state.interpolation
  const isPolar = space === 'hsl' || space === 'oklch'
  const hueSuffix = isPolar && hue !== 'shorter' ? ` ${hue} hue` : ''
  return `in ${space}${hueSuffix}`
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
  const stopList = state.stops.map((s) => `${formatStopColor(s)} ${fmtNum(s.position)}%`).join(', ')
  const interp = interpolationHead(state)
  const prefix = state.repeating ? 'repeating-' : ''

  // CSS Images 4 grammar: the head (angle/shape/position PLUS the
  // color-interpolation-method) is ONE space-separated unit; a comma
  // introduces the color-stop-list, never appears INSIDE the head.
  switch (state.kind) {
    case 'linear': {
      const head = `${fmtNum(normalizeAngle(state.angle))}deg ${interp}`
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
        `from ${fmtNum(normalizeAngle(state.angle))}deg ` +
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
 * module doc comment), computed the same way the browser would: an exact
 * stop match returns that stop's own color; otherwise the two bracketing
 * stops are interpolated in `state.interpolation`. `addStop` stores EXACTLY
 * this string (round-tripped through `parseCssColor`), so a new stop is
 * indistinguishable from the gradient it was picked off.
 */
export function colorAt(state: GradientPickerState, position: number): string {
  const stops = state.stops
  if (stops.length === 0) return '#000000'
  const exact = stops.find((s) => s.position === position)
  if (exact) return formatStopColor(exact)
  const first = stops[0]!
  const last = stops[stops.length - 1]!
  if (position <= first.position) return formatStopColor(first)
  if (position >= last.position) return formatStopColor(last)

  let a = first
  let b = last
  for (let i = 0; i < stops.length - 1; i++) {
    const left = stops[i]!
    const right = stops[i + 1]!
    if (left.position <= position && position <= right.position) {
      a = left
      b = right
      break
    }
  }
  const t = b.position === a.position ? 0 : (position - a.position) / (b.position - a.position)
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
  angle: number
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
 * `to <side-or-corner>` mapped onto a fixed angle in 45° multiples. This is a
 * DELIBERATE simplification: CSS's real corner angle depends on the box's
 * aspect ratio, which a headless machine with no rendered box has no way to
 * know. `to top`/`right`/`bottom`/`left` are exact regardless (0/90/180/270)
 * either way; only the four corners are approximated.
 */
function sideOrCornerToAngle(tokens: readonly string[]): number | null {
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
  return MAP[key] ?? null
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
  angle: number
  center: GradientCenter
  shape: RadialShape
  size: RadialSize
  interpolation: GradientInterpolation
}

function extractInterpolation(
  tokens: readonly string[],
):
  | { ok: true; tokens: string[]; interpolation: GradientInterpolation }
  | { ok: false; reason: string } {
  const inIdx = tokens.findIndex((t) => t.toLowerCase() === 'in')
  if (inIdx === -1) return { ok: true, tokens: [...tokens], interpolation: DEFAULT_INTERPOLATION }

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
    angle: kind === 'linear' ? 180 : 0,
    center: { x: 50, y: 50 },
    shape: 'ellipse',
    size: 'farthest-corner',
    interpolation: DEFAULT_INTERPOLATION,
  }
  if (headPart === null) return { ok: true, value: defaults }

  const extracted = extractInterpolation(splitTopLevelWhitespace(headPart))
  if (!extracted.ok) return extracted
  const tokens = extracted.tokens
  const interpolation = extracted.interpolation

  if (kind === 'linear') {
    if (tokens.length === 0) return { ok: true, value: { ...defaults, interpolation } }
    if (tokens.length === 1) {
      const angle = parseAngleToken(tokens[0]!)
      if (angle !== null) return { ok: true, value: { ...defaults, angle, interpolation } }
    }
    if (tokens[0]?.toLowerCase() === 'to') {
      const angle = sideOrCornerToAngle(tokens.slice(1))
      if (angle === null) {
        return {
          ok: false,
          reason: `unrecognized side-or-corner "to ${tokens.slice(1).join(' ')}"`,
        }
      }
      return { ok: true, value: { ...defaults, angle, interpolation } }
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
    return { ok: true, value: { angle: 0, center, shape, size, interpolation } }
  }

  // conic
  let angle = 0
  let center: GradientCenter = { x: 50, y: 50 }
  let i = 0
  if (tokens[i]?.toLowerCase() === 'from') {
    const a = parseAngleToken(tokens[i + 1] ?? '')
    if (a === null) return { ok: false, reason: `invalid angle "${tokens[i + 1] ?? ''}"` }
    angle = a
    i += 2
  }
  if (tokens[i]?.toLowerCase() === 'at') {
    const pos = parsePosition(tokens.slice(i + 1))
    if (!pos.ok) return pos
    center = pos.value
  } else if (i < tokens.length) {
    return { ok: false, reason: `unrecognized conic-gradient head "${tokens.join(' ')}"` }
  }
  return {
    ok: true,
    value: { angle, center, shape: 'ellipse', size: 'farthest-corner', interpolation },
  }
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
    const model: ColorModel =
      parsedColor.space === 'oklch' || parsedColor.space === 'oklab' ? 'oklch' : 'hsv'
    const { color, alpha } = cssColorToPickerColor(parsedColor, model, DEFAULT_MAX_CHROMA)

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

/**
 * Parse a CSS `<gradient>` (`linear-gradient()`/`radial-gradient()`/
 * `conic-gradient()`, `repeating-` included) into this component's shape.
 * Accepts: angles in `deg`/`grad`/`rad`/`turn`, `to <side-or-corner>`,
 * `at <position>` (percentages + `left`/`center`/`right`/`top`/`bottom`),
 * radial shape/size keywords, `in <space> [<hue> hue]`, 0/1/2 stop positions
 * (a 2-position stop expands to two stops) with missing positions filled per
 * the CSS auto-positioning algorithm, and any color `parseCssColor` accepts.
 *
 * Explicitly REJECTS (with a `reason`, never silently dropping data):
 * length-based stop positions (only `%` is supported), an explicit radial
 * size LENGTH (`circle 40px` — only the four keyword extents), a length-based
 * `at` position, and color hints (a bare percentage in the stop list with no
 * color). `parseGradient(toCss(s))` reproduces `s` modulo stop ids — see the
 * round-trip property test.
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

  return {
    ok: true,
    value: {
      kind,
      repeating,
      angle: headResult.value.angle,
      center: headResult.value.center,
      shape: headResult.value.shape,
      size: headResult.value.size,
      interpolation: headResult.value.interpolation,
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
  /** The horizontal stop ramp: a plain `in <space>` linear-90deg preview of
   * the stop list, regardless of `state.kind` — a fixed, always-comparable
   * frame to place/select/drag stops in. Pointerdown on the bare track (not
   * on an existing stop, which calls `stopPropagation()`) adds a new stop at
   * that position and starts dragging it immediately. */
  track: {
    'data-scope': 'gradient-picker'
    'data-part': 'track'
    style: Signal<string>
    onPointerDown: (e: PointerEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
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
    /** Disabled when the current space has no hue (only `hsl`/`oklch` do). */
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
  cssInput: {
    type: 'text'
    autocomplete: 'off'
    spellcheck: 'false'
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'gradient-picker'
    'data-part': 'css-input'
    onInput: (e: Event) => void
  }
  /**
   * The embedded `color-picker`'s FULL part bag, connected over the DERIVED
   * `pickerStateOf(state)` — eyedropper, OKLCH canvas, model toggle, every
   * slider, all included with zero glue. Messages are wrapped as
   * `{ type: 'picker'; msg }` and unwrapped by this component's `update()`
   * (see the module doc comment) — the same `{ type; msg }` shape the
   * demo-level `composeModules` helper uses for embedding one component's
   * messages in another's, applied here inside the reducer itself because
   * writing back onto "whichever stop is selected" needs bespoke logic a
   * generic by-key slice-replace can't express.
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

  const pickerSend: Send<ColorPickerMsg> = (m) => send({ type: 'picker', msg: m })
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
        const stopList = s.stops
          .map((st) => `${formatStopColor(st)} ${fmtNum(st.position)}%`)
          .join(', ')
        return `background: linear-gradient(90deg in ${s.interpolation.space}, ${stopList});`
      }),
      onPointerDown: tagSend(send, ['addStop', 'moveStop'], trackDrag.onPointerDown),
      onPointerMove: tagSend(send, ['moveStop'], trackDrag.onPointerMove),
      onPointerUp: trackDrag.onPointerUp,
      onPointerCancel: trackDrag.onPointerCancel,
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
        'aria-label': locale.track,
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
        onPointerMove: drag.onPointerMove,
        onPointerUp: drag.onPointerUp,
        onPointerCancel: drag.onPointerCancel,
        onFocus: tagSend(send, ['selectStop'], () => send({ type: 'selectStop', id })),
        onKeyDown: tagSend(send, ['nudgeStop', 'moveStop', 'removeStop'], (e: KeyboardEvent) => {
          const step = e.shiftKey ? coarse : fine
          switch (e.key) {
            case 'ArrowRight':
              e.preventDefault()
              send({ type: 'nudgeStop', id, delta: step })
              return
            case 'ArrowLeft':
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
      value: state.map((s) => String(Math.round(s.angle))),
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
      onPointerUp: centerDrag.onPointerUp,
      onPointerCancel: centerDrag.onPointerCancel,
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
        const current = state.peek().center
        const set = (x: number, y: number): void =>
          send({ type: 'setCenter', x: clamp(x, 0, 100), y: clamp(y, 0, 100) })
        switch (e.key) {
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
        (s) => s.interpolation.space !== 'hsl' && s.interpolation.space !== 'oklch',
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
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => toCss(s)),
      'data-scope': 'gradient-picker',
      'data-part': 'css-input',
      onInput: tagSend(send, ['setGradient'], (e) =>
        send({ type: 'setGradient', css: (e.target as HTMLInputElement).value }),
      ),
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
