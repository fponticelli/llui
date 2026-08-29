import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { enSparkline, sparklineLocale } from '../locale/sparkline.js'
import { deriveOnce } from '../utils/derive.js'
import { finiteBound } from '../utils/number.js'
import {
  calendarTicks,
  floorToUnit,
  type CalendarOptions,
  type CalendarStepOptions,
  type CalendarUnit,
} from '../utils/calendar-ticks.js'
import { linearPath, rectPath, type Curve, type Point } from '../utils/path.js'
import { cartesianProjection, type Frame } from '../utils/projection.js'
import { normalize, type Domain, type Sample } from '../utils/scale.js'

/**
 * Sparkline — "this value, over time, against a reference band", at the size of
 * a table cell.
 *
 * # Why this is not `chart`
 *
 * `chart` is a plotting machine: `ChartState`, a projection seam, a legend, a
 * keyboard cursor over CATEGORIES, and numeric-nice value ticks. A sparkline is
 * a **pure function of its points** — dozens appear in one table, and the only
 * interaction any of them has is a hover readout. So the load-bearing export
 * here is {@link sparklineGeometry}, which takes points and options and returns
 * path strings; it needs no signal, no `send`, no mount and no state.
 *
 * `init`/`update`/`connect` exist BESIDE it, not instead of it, and add exactly
 * one fact: which point the cursor is on. A consumer rendering fifty trends in
 * a table calls the pure function fifty times and pays for nothing else; one
 * that wants a tooltip opts into the machine for that column. The stateless
 * middle ground works too — `connect(constant(state), noSend, { id })` gives
 * the full part bag with the cursor pinned wherever the state says.
 *
 * # What it reuses
 *
 * The geometry is `utils/scale.ts` + `utils/path.ts` + `utils/projection.ts`,
 * the same three files `chart` is built from, so every coordinate goes through
 * `fmt` and a path recomputed from unchanged data is BYTE-IDENTICAL — the
 * reconciler commits on output-equality, and a sparkline in a table is exactly
 * the place where a spuriously-changing path string costs the most.
 *
 * Two things it does NOT reuse, each for a stated reason:
 *
 *  - **`valueDomain`**, because it always includes zero. That is right for a
 *    bar, whose LENGTH states the magnitude and therefore lies if the baseline
 *    is not zero; it is wrong for a trend line, where the shape is the message.
 *    A series reading 118–142 against a 90–120 band has to fill the box, not
 *    sit as a flat smear across the top of a 0–142 axis.
 *  - **`ticks`/`niceDomain`**, because they are NUMERIC. See
 *    `utils/calendar-ticks.ts`: rounding an epoch to a nice number never lands
 *    on the 1st of March.
 *
 * There is no `coord` and no polar projection. A sparkline is inline text
 * furniture; a round one is a different picture, and `chart` already draws it.
 */

// ── Inputs ────────────────────────────────────────────────────────────────

export interface SparklinePoint {
  /** Instant, in epoch milliseconds. */
  at: number
  value: number
  /**
   * Sampling resolution of this reading — "spot", "session", "daily", whatever
   * the domain calls it. Free-form and never interpreted: consecutive points
   * sharing a tag become one segment of the granularity track, so a line whose
   * sampling changes SAYS so instead of implying uniform data.
   */
  grain?: string
}

/**
 * A reference band. Both bounds are UNBOUNDED-CAPABLE in the sense of
 * `finiteBound` (#177): "no bound on this side" is spelled by OMITTING the key,
 * never by `undefined`, `null` or `±Infinity` — only the omission survives a
 * JSON round trip key-for-key, and this lives in state.
 *
 * The three readings are not a convenience, they are the whole point: both
 * bounds shade BETWEEN them, a high alone shades everything BELOW it, and a low
 * alone shades everything ABOVE it. "Acceptable is under 140" and "acceptable
 * is between 90 and 120" are different statements and must not both come out as
 * a stripe.
 */
export interface SparklineBand {
  low?: number
  high?: number
}

/**
 * Leading-outlier trimming. A HEURISTIC that DISCARDS REAL DATA, so it is off
 * unless asked for: `trim: null` is the default, and a chart that silently
 * drops a reading is worse than a squashed one.
 *
 * The rule: while more than `floor` points remain, compare the FIRST gap
 * against the MEDIAN of the gaps after it, and drop the leading point when the
 * first gap is more than `factor` times that median. Median rather than mean so
 * a second ancient reading cannot inflate the yardstick it is being measured
 * against; `factor > 1` is required, and a median of zero (every remaining
 * reading at the same instant) stops the walk rather than eating the series.
 *
 * `trimmed` in the geometry reports how many points went, so a consumer can say
 * so on the page.
 */
export interface SparklineTrim {
  /** How many times the median gap the leading gap must exceed. Default 4. */
  factor: number
  /** Never trim below this many points. Default 3, floored at 2 — one point is
   *  not a trend and cannot be drawn as a line. */
  floor: number
}

export interface SparklinePadding {
  top: number
  right: number
  bottom: number
  left: number
}

/** The granularity track: a thin bar under the plot, in the bottom padding. */
export interface SparklineTrack {
  height: number
  /** Distance between the bottom of the plot frame and the top of the track. */
  gap: number
}

export type SparklineTone = 'below' | 'in' | 'above' | 'none'
export type SparklineBandKind = 'between' | 'below' | 'above'

// ── State ─────────────────────────────────────────────────────────────────

export interface SparklineState {
  points: SparklinePoint[]
  /** Omit a side to leave it unbounded — see {@link SparklineBand}. */
  band: SparklineBand
  /**
   * The instant the RIGHT EDGE denotes. A stale series then visibly trails off
   * instead of looking current, which is the difference between "the last
   * reading was fine" and "the last reading was fine, eight months ago".
   *
   * UNBOUNDED-CAPABLE: omit it and the edge is the last reading's own instant.
   * It is deliberately NOT defaulted to `Date.now()` anywhere in this module —
   * geometry has to be a pure function of state or an SSR render and the first
   * client render disagree, and `Date.now()` would additionally make the path
   * string change on every recomputation, which is the one thing `fmt` exists
   * to prevent. A consumer that wants "now" puts a clock in its own state.
   */
  now?: number
  /** Value-axis bounds. UNBOUNDED-CAPABLE (#177): omit to derive. */
  min?: number
  max?: number
  width: number
  height: number
  padding: SparklinePadding
  curve: Curve
  /** `null` = no trimming. See {@link SparklineTrim}. */
  trim: SparklineTrim | null
  /** `null` = no granularity track. */
  track: SparklineTrack | null
  /** Fixed offset from UTC that calendar boundaries are measured in, and the
   *  ladder's ceiling. See `utils/calendar-ticks.ts` on why it is an offset and
   *  not a zone. */
  calendar: SparklineCalendar
  /** Index of the point under the pointer or keyboard cursor. */
  activeIndex: number | null
}

/** The serializable subset of {@link CalendarStepOptions} this state carries. */
export interface SparklineCalendar {
  offsetMinutes: number
  weekStartsOn: number
  maxTicks: number
  /** Force a rung instead of choosing one from the span. */
  unit?: CalendarUnit
}

export type SparklineMsg =
  /** @intent("Set the point under the cursor, or clear it with null") */
  | { type: 'setActive'; index: number | null }
  /** @intent("Move the cursor along the points by delta, clamping at the ends") */
  | { type: 'moveActive'; delta: number }
  /** @intent("Move the cursor to the first point") */
  | { type: 'firstActive' }
  /** @intent("Move the cursor to the last point") */
  | { type: 'lastActive' }
  /** @intent("Replace the plotted points") */
  | { type: 'setPoints'; points: SparklinePoint[] }
  /** @intent("Set the instant the right edge denotes, or derive it with null") */
  | { type: 'setNow'; at: number | null }
  /** @intent("Set the reference band; null on a side leaves it unbounded") */
  | { type: 'setBand'; low: number | null; high: number | null }
  /** @intent("Set the viewBox size in user units") */
  | { type: 'setSize'; width: number; height: number }

export interface SparklineInit {
  points?: readonly SparklinePoint[]
  band?: SparklineBand
  now?: number
  min?: number
  max?: number
  width?: number
  height?: number
  padding?: Partial<SparklinePadding>
  curve?: Curve
  /** `true` for the documented defaults, an object to tune them, absent for
   *  OFF — trimming discards data, so it is never on by accident. */
  trim?: boolean | Partial<SparklineTrim>
  track?: SparklineTrack | null
  calendar?: Partial<SparklineCalendar>
}

const DEFAULT_PADDING: SparklinePadding = { top: 2, right: 2, bottom: 6, left: 2 }
const DEFAULT_TRACK: SparklineTrack = { height: 2, gap: 2 }
const DEFAULT_TRIM: SparklineTrim = { factor: 4, floor: 3 }
const DEFAULT_CALENDAR: SparklineCalendar = { offsetMinutes: 0, weekStartsOn: 1, maxTicks: 4 }

/** Write a bound only when it is finite, so an absent one stays ABSENT rather
 *  than becoming a `undefined`-valued key that JSON turns into `null`. */
function writeBound(into: Record<string, unknown>, key: string, value: number | undefined): void {
  const bound = finiteBound(value)
  if (bound !== undefined) into[key] = bound
}

function normalizeBand(band: SparklineBand | undefined): SparklineBand {
  const out: SparklineBand = {}
  writeBound(out as Record<string, unknown>, 'low', band?.low)
  writeBound(out as Record<string, unknown>, 'high', band?.high)
  return out
}

function normalizeTrim(trim: SparklineInit['trim']): SparklineTrim | null {
  if (trim === undefined || trim === false) return null
  if (trim === true) return { ...DEFAULT_TRIM }
  const factor = finiteBound(trim.factor) ?? DEFAULT_TRIM.factor
  const floor = finiteBound(trim.floor) ?? DEFAULT_TRIM.floor
  return { factor, floor }
}

export function init(opts: SparklineInit = {}): SparklineState {
  const calendar: SparklineCalendar = {
    offsetMinutes: finiteBound(opts.calendar?.offsetMinutes) ?? DEFAULT_CALENDAR.offsetMinutes,
    weekStartsOn: finiteBound(opts.calendar?.weekStartsOn) ?? DEFAULT_CALENDAR.weekStartsOn,
    maxTicks: finiteBound(opts.calendar?.maxTicks) ?? DEFAULT_CALENDAR.maxTicks,
  }
  if (opts.calendar?.unit !== undefined) calendar.unit = opts.calendar.unit
  const state: SparklineState = {
    points: [...(opts.points ?? [])],
    band: normalizeBand(opts.band),
    width: finiteBound(opts.width) ?? 120,
    height: finiteBound(opts.height) ?? 32,
    padding: { ...DEFAULT_PADDING, ...opts.padding },
    curve: opts.curve ?? 'linear',
    trim: normalizeTrim(opts.trim),
    track: opts.track === undefined ? { ...DEFAULT_TRACK } : opts.track,
    calendar,
    activeIndex: null,
  }
  writeBound(state as unknown as Record<string, unknown>, 'now', opts.now)
  writeBound(state as unknown as Record<string, unknown>, 'min', opts.min)
  writeBound(state as unknown as Record<string, unknown>, 'max', opts.max)
  return state
}

/** Clamp a cursor index into the point range, or `null` when there is none. */
function clampIndex(index: number | null, count: number): number | null {
  if (index === null || count === 0) return null
  if (!isFinite(index)) return null
  return Math.max(0, Math.min(count - 1, Math.trunc(index)))
}

export function update(state: SparklineState, msg: SparklineMsg): [SparklineState, never[]] {
  switch (msg.type) {
    case 'setActive':
      return [{ ...state, activeIndex: clampIndex(msg.index, drawnCount(state)) }, []]
    case 'moveActive': {
      const count = drawnCount(state)
      if (count === 0) return [state, []]
      const from = state.activeIndex ?? (msg.delta >= 0 ? -1 : count)
      return [{ ...state, activeIndex: clampIndex(from + msg.delta, count) }, []]
    }
    case 'firstActive':
      return [{ ...state, activeIndex: clampIndex(0, drawnCount(state)) }, []]
    case 'lastActive': {
      const count = drawnCount(state)
      return [{ ...state, activeIndex: clampIndex(count - 1, count) }, []]
    }
    case 'setPoints': {
      const next: SparklineState = { ...state, points: [...msg.points] }
      return [{ ...next, activeIndex: clampIndex(state.activeIndex, drawnCount(next)) }, []]
    }
    case 'setNow': {
      const next = { ...state }
      if (msg.at === null) delete next.now
      else writeBound(next as unknown as Record<string, unknown>, 'now', msg.at)
      return [next, []]
    }
    case 'setBand': {
      const band: SparklineBand = {}
      writeBound(band as Record<string, unknown>, 'low', msg.low ?? undefined)
      writeBound(band as Record<string, unknown>, 'high', msg.high ?? undefined)
      return [{ ...state, band }, []]
    }
    case 'setSize':
      return [
        {
          ...state,
          width: finiteBound(msg.width) ?? state.width,
          height: finiteBound(msg.height) ?? state.height,
        },
        [],
      ]
  }
}

/** How many points the geometry will actually draw — after dropping non-finite
 *  samples and after trimming. The cursor addresses THAT list, so every reducer
 *  clamps against it rather than against `state.points.length`. */
function drawnCount(state: SparklineState): number {
  return geometry(state).dots.length
}

// ── Geometry ──────────────────────────────────────────────────────────────

export interface SparklineTick {
  at: number
  unit: CalendarUnit
  x: number
  /** The vertical gridline, in user units. */
  d: string
  /** Stable key for a keyed `each`. */
  key: string
}

export interface SparklineDot {
  index: number
  at: number
  value: number
  x: number
  y: number
  tone: SparklineTone
  /** True for the most recent drawn point — the reading the row is about. */
  last: boolean
  /** True for the point under the cursor. Follows `chart`: the cursor is part
   *  of the derived picture, so one signal per row carries everything a dot
   *  renders from and nothing has to combine two signals at the call site. */
  active: boolean
  key: string
}

export interface SparklineSpan {
  grain: string
  /** First and last instant the segment covers. */
  from: number
  to: number
  x0: number
  x1: number
  d: string
  key: string
}

export interface SparklineBandGeometry {
  kind: SparklineBandKind
  low: number | null
  high: number | null
  d: string
}

export interface SparklineNow {
  at: number
  x: number
  d: string
  /** True when the right edge is later than the last reading — the series
   *  trails off. */
  stale: boolean
}

/** One row of the visually-hidden `<table>` fallback. */
export interface SparklineRow {
  at: number
  /** `YYYY-MM-DD` in the configured offset's calendar. Locale-neutral by
   *  design: the table is a data fallback, not a formatted report. */
  day: string
  value: number
  tone: SparklineTone
  grain: string | null
}

/** The facts a label is composed from. Separated from the label itself so the
 *  same numbers can be phrased by the locale in `connect` and by the built-in
 *  English template in the pure path. */
export interface SparklineSummary {
  count: number
  /** `YYYY-MM-DD` of the first and last drawn reading; empty strings when there
   *  is no data. */
  from: string
  to: string
  trimmed: number
  stale: boolean
}

export interface SparklineGeometry {
  frame: Frame
  time: Domain
  value: Domain
  /** The points actually drawn: finite, sorted, and after trimming. */
  points: SparklinePoint[]
  trimmed: number
  /** The trend line. Empty string when there is nothing to draw. */
  path: string
  band: SparklineBandGeometry | null
  ticks: SparklineTick[]
  dots: SparklineDot[]
  spans: SparklineSpan[]
  now: SparklineNow
  summary: SparklineSummary
  /** Built-in English composition of {@link summary}. `connect` replaces it
   *  with the locale's phrasing. */
  label: string
  rows: SparklineRow[]
}

export interface SparklineGeometryOptions {
  band?: SparklineBand
  now?: number
  min?: number
  max?: number
  width?: number
  height?: number
  padding?: Partial<SparklinePadding>
  curve?: Curve
  trim?: SparklineTrim | null
  track?: SparklineTrack | null
  calendar?: Partial<SparklineCalendar>
  /** Which drawn point the cursor is on. Indexes the DRAWN list — after
   *  non-finite samples are dropped and after trimming — so it is the same
   *  index `locateIndex` returns. */
  activeIndex?: number | null
}

/** How much of the value span to leave as breathing room above and below.
 *  A trend that touches the frame edge reads as clipped. */
const VALUE_PAD = 0.05

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Drop leading points separated from the rest by a disproportionate gap. See
 * {@link SparklineTrim} for the rule and for why this is opt-in.
 */
export function trimLeadingOutliers(
  points: readonly SparklinePoint[],
  trim: SparklineTrim | null,
): { points: SparklinePoint[]; trimmed: number } {
  const all = [...points]
  if (trim === null) return { points: all, trimmed: 0 }
  // The `2` is LOAD-BEARING and its job is the ONE-point series, not the
  // two-point one. With `floor <= 1` and a single reading, `all.length - cut >
  // floor` holds at cut 0 and the loop below dereferences `all[cut + 1]`,
  // which does not exist — a TypeError out of a pure geometry function. Two
  // points are already covered by the zero-median break (their trailing-gap
  // list is empty), which is why a three-point fixture does NOT exercise this
  // clamp and a one-point one does. `floor: 0` is reachable: `finiteBound(0)`
  // is `0`, so `init({ trim: { floor: 0 } })` normalizes to exactly that.
  const floor = Math.max(2, Math.trunc(finiteBound(trim.floor) ?? DEFAULT_TRIM.floor))
  const factor = finiteBound(trim.factor) ?? DEFAULT_TRIM.factor
  // A factor of 1 or less calls every gap disproportionate and would walk the
  // series down to the floor on ordinary data.
  if (!(factor > 1)) return { points: all, trimmed: 0 }
  let cut = 0
  while (all.length - cut > floor) {
    const lead = all[cut + 1]!.at - all[cut]!.at
    const rest: number[] = []
    for (let i = cut + 1; i < all.length - 1; i++) rest.push(all[i + 1]!.at - all[i]!.at)
    const mid = median(rest)
    if (!(mid > 0) || !(lead > factor * mid)) break
    cut++
  }
  return { points: all.slice(cut), trimmed: cut }
}

/** `YYYY-MM-DD` for an instant, in the given fixed offset's calendar. */
export function isoDay(at: number, opts: CalendarOptions = {}): string {
  if (!isFinite(at)) return ''
  const day = floorToUnit(at, 'day', opts)
  const d = new Date(day + (opts.offsetMinutes ?? 0) * 60_000)
  const year = d.getUTCFullYear()
  const yyyy = year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0')
  return `${yyyy}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Phrasing for a {@link SparklineSummary}. The strings are injected so the
 *  locale can supply them in `connect` and the pure path can default to
 *  English without a second template. */
export function sparklineLabel(
  summary: SparklineSummary,
  strings: { empty: string; range: (count: number, from: string, to: string) => string },
): string {
  return summary.count === 0
    ? strings.empty
    : strings.range(summary.count, summary.from, summary.to)
}

function classify(value: number, low: number | null, high: number | null): SparklineTone {
  if (low === null && high === null) return 'none'
  if (low !== null && value < low) return 'below'
  if (high !== null && value > high) return 'above'
  return 'in'
}

/**
 * The whole picture, as data. A PURE function: same inputs, same output, and
 * the same output on a server as in a browser.
 */
export function sparklineGeometry(
  points: readonly SparklinePoint[],
  opts: SparklineGeometryOptions = {},
): SparklineGeometry {
  const width = finiteBound(opts.width) ?? 120
  const height = finiteBound(opts.height) ?? 32
  const padding = { ...DEFAULT_PADDING, ...opts.padding }
  const track = opts.track === undefined ? { ...DEFAULT_TRACK } : opts.track
  const frame: Frame = {
    x: padding.left,
    y: padding.top,
    width: Math.max(0, width - padding.left - padding.right),
    height: Math.max(0, height - padding.top - padding.bottom),
  }
  const projection = cartesianProjection(frame)

  // A non-finite sample cannot be placed, and one `NaN` in a path voids the
  // WHOLE path element — so they are dropped here rather than formatted to 0,
  // which would draw a reading nobody took.
  const finite = points.filter((p) => isFinite(p.at) && isFinite(p.value))
  const sorted = [...finite].sort((a, b) => a.at - b.at)
  const { points: drawn, trimmed } = trimLeadingOutliers(sorted, opts.trim ?? null)

  const low = finiteBound(opts.band?.low) ?? null
  const high = finiteBound(opts.band?.high) ?? null

  const first = drawn[0]
  const lastPoint = drawn[drawn.length - 1]
  const nowAt = Math.max(finiteBound(opts.now) ?? lastPoint?.at ?? 0, lastPoint?.at ?? 0)
  const time: Domain = { min: first?.at ?? 0, max: drawn.length === 0 ? 1 : nowAt }

  // The value axis spans the readings AND the band bounds: an unshown band edge
  // is a shaded region whose meaning is off-screen. Deliberately NOT
  // `valueDomain` — see the module note on why a trend line's baseline is not
  // zero.
  const spread: number[] = drawn.map((p) => p.value)
  if (low !== null) spread.push(low)
  if (high !== null) spread.push(high)
  const value = valueSpan(spread, finiteBound(opts.min), finiteBound(opts.max))

  const samples: Sample[] = drawn.map((p) => ({
    u: normalize(p.at, time),
    v: normalize(p.value, value),
  }))
  const path = drawn.length === 0 ? '' : projection.line(samples, opts.curve ?? 'linear')

  const band: SparklineBandGeometry | null =
    low === null && high === null
      ? null
      : {
          kind: low !== null && high !== null ? 'between' : high !== null ? 'below' : 'above',
          low,
          high,
          d: projection.band(
            0,
            1,
            low !== null ? normalize(low, value) : 0,
            high !== null ? normalize(high, value) : 1,
          ),
        }

  const vLine = (u: number): string =>
    linearPath([projection.point(u, 0) as Point, projection.point(u, 1) as Point])

  const calendar: CalendarStepOptions = {
    offsetMinutes: opts.calendar?.offsetMinutes ?? DEFAULT_CALENDAR.offsetMinutes,
    weekStartsOn: opts.calendar?.weekStartsOn ?? DEFAULT_CALENDAR.weekStartsOn,
    maxTicks: opts.calendar?.maxTicks ?? DEFAULT_CALENDAR.maxTicks,
  }
  if (opts.calendar?.unit !== undefined) calendar.unit = opts.calendar.unit

  const ticks: SparklineTick[] =
    drawn.length === 0
      ? []
      : calendarTicks(time.min, time.max, calendar).map((t) => {
          const u = normalize(t.at, time)
          return {
            at: t.at,
            unit: t.unit,
            x: projection.point(u, 0).x,
            d: vLine(u),
            key: `t${t.at}`,
          }
        })

  const activeIndex = opts.activeIndex ?? null
  const dots: SparklineDot[] = drawn.map((p, i) => {
    const at = projection.point(samples[i]!.u, samples[i]!.v)
    return {
      index: i,
      at: p.at,
      value: p.value,
      x: at.x,
      y: at.y,
      tone: classify(p.value, low, high),
      last: i === drawn.length - 1,
      active: activeIndex === i,
      // Two readings can share an instant, so the index is part of the key.
      key: `${i}:${p.at}`,
    }
  })

  const spans = trackSpans(drawn, track, frame, time, nowAt, projection)

  const now: SparklineNow = {
    at: nowAt,
    x: projection.point(1, 0).x,
    d: vLine(1),
    stale: lastPoint !== undefined && nowAt > lastPoint.at,
  }

  const summary: SparklineSummary = {
    count: drawn.length,
    from: first === undefined ? '' : isoDay(first.at, calendar),
    to: lastPoint === undefined ? '' : isoDay(lastPoint.at, calendar),
    trimmed,
    stale: now.stale,
  }

  const rows: SparklineRow[] = drawn.map((p) => ({
    at: p.at,
    day: isoDay(p.at, calendar),
    value: p.value,
    tone: classify(p.value, low, high),
    grain: p.grain ?? null,
  }))

  return {
    frame,
    time,
    value,
    points: drawn,
    trimmed,
    path,
    band,
    ticks,
    dots,
    spans,
    now,
    summary,
    label: sparklineLabel(summary, enSparkline),
    rows,
  }
}

/**
 * The value axis. Padded outward so the line does not touch the frame edge, and
 * expanded to a unit interval when every reading is identical — a zero span
 * would put the whole series on one row of pixels and `normalize` would answer
 * 0.5 for all of it.
 *
 * An explicit bound replaces the derived one on ITS side only, so pinning a
 * floor does not also pin a ceiling.
 */
function valueSpan(values: readonly number[], min?: number, max?: number): Domain {
  if (values.length === 0) return { min: min ?? 0, max: max ?? 1 }
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (lo === hi) {
    lo -= 0.5
    hi += 0.5
  } else {
    const pad = (hi - lo) * VALUE_PAD
    lo -= pad
    hi += pad
  }
  const outLo = min ?? lo
  const outHi = max ?? hi
  return outLo === outHi ? { min: outLo, max: outLo + 1 } : { min: outLo, max: outHi }
}

/**
 * The granularity track: consecutive points sharing a `grain` become one
 * segment.
 *
 * A segment runs from its first point to the START of the next segment (or to
 * the right edge for the last one), not from its first point to its last. Two
 * reasons: a single-reading segment would otherwise have zero width and be
 * invisible, and "spot readings until the daily aggregates began" is what the
 * track is actually saying.
 *
 * Points with NO `grain` still take part in the tiling — so a tagged stretch
 * cannot bleed across an untagged one — and are then omitted, leaving a real
 * gap where the resolution is unstated.
 */
function trackSpans(
  points: readonly SparklinePoint[],
  track: SparklineTrack | null,
  frame: Frame,
  time: Domain,
  nowAt: number,
  projection: ReturnType<typeof cartesianProjection>,
): SparklineSpan[] {
  if (track === null || points.length === 0) return []
  if (!points.some((p) => (p.grain ?? '') !== '')) return []
  const top = frame.y + frame.height + track.gap
  const bottom = top + track.height

  const runs: { grain: string; from: number; index: number }[] = []
  for (let i = 0; i < points.length; i++) {
    const grain = points[i]!.grain ?? ''
    if (runs.length === 0 || runs[runs.length - 1]!.grain !== grain) {
      runs.push({ grain, from: points[i]!.at, index: i })
    }
  }

  const out: SparklineSpan[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if (run.grain === '') continue
    const to = i + 1 < runs.length ? runs[i + 1]!.from : nowAt
    const x0 = projection.point(normalize(run.from, time), 0).x
    const x1 = projection.point(normalize(to, time), 0).x
    out.push({
      grain: run.grain,
      from: run.from,
      to,
      x0,
      x1,
      d: rectPath(x0, top, x1, bottom),
      key: `${run.index}:${run.grain}`,
    })
  }
  return out
}

/**
 * A memoized {@link sparklineGeometry}, one cell per instance.
 *
 * Hold it in a closure, never at module scope: a table of fifty sparklines
 * sharing one cell would evict on every call and the memo would never hit —
 * the same rule `utils/derive.ts` states for per-item derivations.
 */
export function createSparklineGeometry(): (state: SparklineState) => SparklineGeometry {
  return deriveOnce(geometryFrom)
}

function geometryFrom(state: SparklineState): SparklineGeometry {
  const opts: SparklineGeometryOptions = {
    band: state.band,
    width: state.width,
    height: state.height,
    padding: state.padding,
    curve: state.curve,
    trim: state.trim,
    track: state.track,
    calendar: state.calendar,
    activeIndex: state.activeIndex,
  }
  if (state.now !== undefined) opts.now = state.now
  if (state.min !== undefined) opts.min = state.min
  if (state.max !== undefined) opts.max = state.max
  return sparklineGeometry(state.points, opts)
}

/** Module-level memo for the free {@link geometry} entry point. One cell, so a
 *  consumer drawing many sparklines should hold its own via
 *  {@link createSparklineGeometry} — or call `sparklineGeometry` directly. */
const geometryOf = deriveOnce(geometryFrom)

/** Derived geometry for a state. Exported so a consumer can measure or test a
 *  sparkline without mounting one. */
export function geometry(state: SparklineState): SparklineGeometry {
  return geometryOf(state)
}

/**
 * The drawn point nearest a position in user units — the pointer hit test.
 * Nearest-x, because dots are a run along the axis with no extents to contain
 * a pointer.
 *
 * A TIE goes to the EARLIER point (`<`, not `<=`). Ties are not hypothetical —
 * two readings can share an instant, which is why a dot's key carries its index
 * — and either rule is defensible; what is not defensible is leaving it
 * unstated, since a silent flip changes which reading a tooltip reports.
 */
export function locateIndex(geo: SparklineGeometry, x: number): number | null {
  if (geo.dots.length === 0 || !isFinite(x)) return null
  let best = 0
  let bestDistance = Infinity
  for (const dot of geo.dots) {
    const d = Math.abs(x - dot.x)
    if (d < bestDistance) {
      bestDistance = d
      best = dot.index
    }
  }
  return best
}

// ── connect ───────────────────────────────────────────────────────────────

export interface SparklineParts {
  root: {
    'data-scope': 'sparkline'
    'data-part': 'root'
    'data-stale': Signal<'' | undefined>
    'data-active': Signal<'' | undefined>
  }
  /**
   * The `<svg>`. `role="img"` named through its own `<title>`/`<desc>`; the
   * numbers live in {@link SparklineParts.table}, because an SVG polyline is
   * otherwise silent and the WAI-ARIA graphics roles are not carried well
   * enough to be the only route to the data.
   */
  svg: {
    'data-scope': 'sparkline'
    'data-part': 'svg'
    role: 'img'
    'aria-labelledby': string
    viewBox: Signal<string>
    tabindex: 0
    onKeyDown: (e: KeyboardEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onBlur: (e: FocusEvent) => void
  }
  title: { id: string; 'data-scope': 'sparkline'; 'data-part': 'title' }
  desc: { id: string; 'data-scope': 'sparkline'; 'data-part': 'desc' }
  /** The visually-hidden `<table>` fallback. Render it with {@link rows}. */
  table: {
    'data-scope': 'sparkline'
    'data-part': 'table'
    'aria-label': Signal<string>
  }
  /** The reference band. Stays MOUNTED and hides itself, so a band appearing or
   *  disappearing does not rebuild the layer. */
  band: {
    'data-scope': 'sparkline'
    'data-part': 'band'
    'data-band': Signal<'between' | 'below' | 'above' | undefined>
    d: Signal<string>
    hidden: Signal<boolean>
  }
  line: { 'data-scope': 'sparkline'; 'data-part': 'line'; d: Signal<string> }
  /** The right edge. `data-stale` is set when it is later than the last
   *  reading. */
  now: {
    'data-scope': 'sparkline'
    'data-part': 'now'
    'data-stale': Signal<'' | undefined>
    d: Signal<string>
  }
  /** A `<g>` stacking layer. Static — spread it on each layer group. */
  layer: { 'data-scope': 'sparkline'; 'data-part': 'layer' }
  /**
   * Per-row attribute bags. Each takes the ROW SIGNAL an `each` hands its
   * render function, not a snapshot value, and every geometry-derived
   * attribute comes back as a Signal.
   *
   * That is not decoration. A keyed `each` REUSES a row whose key is unchanged,
   * so a dot whose key is `index:instant` survives a change of time domain —
   * and a static `cx` read at build time would then be frozen at the position
   * the point had under the OLD domain, with the key giving no hint that
   * anything moved. Taking the row signal is what makes the reuse safe.
   */
  tickProps: (tick: Signal<SparklineTick>) => {
    'data-scope': 'sparkline'
    'data-part': 'grid'
    'data-unit': Signal<'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'>
    d: Signal<string>
  }
  dotProps: (dot: Signal<SparklineDot>) => {
    'data-scope': 'sparkline'
    'data-part': 'dot'
    'data-tone': Signal<'below' | 'in' | 'above' | 'none'>
    'data-last': Signal<'' | undefined>
    'data-active': Signal<'' | undefined>
    cx: Signal<number>
    cy: Signal<number>
  }
  spanProps: (span: Signal<SparklineSpan>) => {
    'data-scope': 'sparkline'
    'data-part': 'span'
    'data-grain': Signal<string>
    d: Signal<string>
  }
  /** Tooltip ATTRIBUTES — spreadable, with its own reactive `hidden`. */
  tooltip: {
    'data-scope': 'sparkline'
    'data-part': 'tooltip'
    role: 'status'
    'aria-live': 'polite'
    hidden: Signal<boolean>
    style: Signal<string>
  }
  ticks: Signal<SparklineTick[]>
  dots: Signal<SparklineDot[]>
  spans: Signal<SparklineSpan[]>
  rows: Signal<SparklineRow[]>
  /** The dot under the cursor, or `null`. */
  activeDot: Signal<SparklineDot | null>
  /** The composed accessible name — the locale's phrasing of
   *  {@link SparklineGeometry.summary}, or `opts.label` when given. */
  label: Signal<string>
  summary: Signal<SparklineSummary>
}

export interface SparklineConnectOptions {
  /** Base id; the title and description ids derive from it. */
  id: string
  /** Override the composed accessible name entirely. */
  label?: string
  /** Longer description, announced with the name. Defaults to empty. */
  description?: string
}

export function connect(
  state: Signal<SparklineState>,
  send: Send<SparklineMsg>,
  opts: SparklineConnectOptions,
): SparklineParts {
  const titleId = `${opts.id}:title`
  const descId = `${opts.id}:desc`
  const locale = sparklineLocale()
  // One memo cell per CONNECT, so two mounted sparklines cannot evict each
  // other's geometry — `utils/derive.ts` on why this is never module scope.
  const geo = createSparklineGeometry()

  /**
   * Pointer → point. `offsetX/Y` are CSS pixels of the rendered box and the
   * geometry is in viewBox units, so the two are related by the element's own
   * scale — read it from the live element, or every hit test is wrong the
   * moment CSS resizes the sparkline.
   */
  const indexAt = (e: PointerEvent): number | null => {
    const el = e.currentTarget as SVGSVGElement | null
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return null
    const s = state.peek()
    const x = ((e.clientX - rect.left) / rect.width) * s.width
    return locateIndex(geo(s), x)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const s = state.peek()
    if (geo(s).dots.length === 0) return
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        send({ type: 'moveActive', delta: 1 })
        return
      case 'ArrowLeft':
        e.preventDefault()
        send({ type: 'moveActive', delta: -1 })
        return
      case 'Home':
        e.preventDefault()
        send({ type: 'firstActive' })
        return
      case 'End':
        e.preventDefault()
        send({ type: 'lastActive' })
        return
      case 'Escape':
        if (s.activeIndex === null) return
        e.preventDefault()
        send({ type: 'setActive', index: null })
        return
      default:
    }
  }

  const activeDotOf = (s: SparklineState): SparklineDot | null =>
    s.activeIndex === null ? null : (geo(s).dots.find((d) => d.active) ?? null)

  return {
    root: {
      'data-scope': 'sparkline',
      'data-part': 'root',
      'data-stale': state.map((s) => (geo(s).now.stale ? '' : undefined)),
      'data-active': state.map((s) => (activeDotOf(s) !== null ? '' : undefined)),
    },
    svg: {
      'data-scope': 'sparkline',
      'data-part': 'svg',
      role: 'img',
      'aria-labelledby': `${titleId} ${descId}`,
      viewBox: state.map((s) => `0 0 ${s.width} ${s.height}`),
      tabindex: 0,
      onKeyDown: tagSend(send, ['moveActive', 'firstActive', 'lastActive', 'setActive'], onKeyDown),
      onPointerMove: tagSend(send, ['setActive'], (e: PointerEvent) => {
        const index = indexAt(e)
        if (index !== null) send({ type: 'setActive', index })
      }),
      onPointerLeave: tagSend(send, ['setActive'], () => send({ type: 'setActive', index: null })),
      onBlur: tagSend(send, ['setActive'], () => send({ type: 'setActive', index: null })),
    },
    title: { id: titleId, 'data-scope': 'sparkline', 'data-part': 'title' },
    desc: { id: descId, 'data-scope': 'sparkline', 'data-part': 'desc' },
    table: {
      'data-scope': 'sparkline',
      'data-part': 'table',
      'aria-label': state.map((s) => opts.label ?? sparklineLabel(geo(s).summary, locale)),
    },
    band: {
      'data-scope': 'sparkline',
      'data-part': 'band',
      'data-band': state.map((s) => geo(s).band?.kind),
      d: state.map((s) => geo(s).band?.d ?? ''),
      hidden: state.map((s) => geo(s).band === null),
    },
    line: {
      'data-scope': 'sparkline',
      'data-part': 'line',
      d: state.map((s) => geo(s).path),
    },
    now: {
      'data-scope': 'sparkline',
      'data-part': 'now',
      'data-stale': state.map((s) => (geo(s).now.stale ? '' : undefined)),
      d: state.map((s) => geo(s).now.d),
    },
    layer: { 'data-scope': 'sparkline', 'data-part': 'layer' },
    tickProps: (tick) => ({
      'data-scope': 'sparkline',
      'data-part': 'grid',
      'data-unit': tick.at('unit'),
      d: tick.at('d'),
    }),
    dotProps: (dot) => ({
      'data-scope': 'sparkline',
      'data-part': 'dot',
      'data-tone': dot.at('tone'),
      'data-last': dot.map((d) => (d.last ? '' : undefined)),
      'data-active': dot.map((d) => (d.active ? '' : undefined)),
      cx: dot.at('x'),
      cy: dot.at('y'),
    }),
    spanProps: (span) => ({
      'data-scope': 'sparkline',
      'data-part': 'span',
      'data-grain': span.at('grain'),
      d: span.at('d'),
    }),
    tooltip: {
      'data-scope': 'sparkline',
      'data-part': 'tooltip',
      role: 'status',
      'aria-live': 'polite',
      hidden: state.map((s) => activeDotOf(s) === null),
      // Percentages of the viewBox, so the tooltip tracks the dot under any CSS
      // size without a second measurement.
      style: state.map((s) => {
        const dot = activeDotOf(s)
        if (dot === null) return 'display:none'
        const left = s.width === 0 ? 0 : (dot.x / s.width) * 100
        const top = s.height === 0 ? 0 : (dot.y / s.height) * 100
        return `left:${left}%;top:${top}%`
      }),
    },
    ticks: state.map((s) => geo(s).ticks),
    dots: state.map((s) => geo(s).dots),
    spans: state.map((s) => geo(s).spans),
    rows: state.map((s) => geo(s).rows),
    activeDot: state.map(activeDotOf),
    label: state.map((s) => opts.label ?? sparklineLabel(geo(s).summary, locale)),
    summary: state.map((s) => geo(s).summary),
  }
}

export const sparkline = {
  init,
  update,
  connect,
  geometry,
  sparklineGeometry,
  createSparklineGeometry,
  locateIndex,
  trimLeadingOutliers,
  sparklineLabel,
  isoDay,
}
