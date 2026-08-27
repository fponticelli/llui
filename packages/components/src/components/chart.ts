import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { deriveOnce } from '../utils/derive.js'
import { allFiniteNumbers, finiteBound, positiveFiniteOrDefault } from '../utils/number.js'
import {
  bandCenter,
  bandExtent,
  nearestBand,
  nearestShare,
  normalize,
  shareExtents,
  ticks as niceTicks,
  valueDomain,
  type Band,
  type Domain,
  type Sample,
  type ShareSlice,
} from '../utils/scale.js'
import { projectionFor, type ChartCoord, type Frame, type Projection } from '../utils/projection.js'
import type { Curve } from '../utils/path.js'

/**
 * Chart — a cartesian/polar plotting machine.
 *
 * # Why this is a machine and not just a class recipe
 *
 * shadcn/ui's `chart.tsx` is a Recharts wrapper: a container that injects
 * `--color-<key>` variables from a config, plus tooltip and legend recipes. The
 * drawing, the interaction and the accessibility are Recharts'. Recharts is
 * React-only, so a port has to answer both halves itself, and the second half —
 * hover, keyboard traversal, a readable fallback — is exactly the kind of thing
 * `@llui/components` exists to stop every consumer re-implementing.
 *
 * Nothing is drawn here. The machine derives GEOMETRY as data (path strings,
 * points, tick placements) and the view renders it with ordinary `elNS` SVG
 * elements and keyed `each`. That is the same shape `qr-code` already uses, and
 * it keeps a chart inside the reactive model rather than behind a `foreign()`
 * seam that owns its own DOM and its own state.
 *
 * # Coordinate systems
 *
 * `coord: 'cartesian' | 'polar'` is ONE field, and switching it re-projects
 * every mark, gridline, tick and hit test. Nothing below branches on it — see
 * `utils/projection.ts`, which is the only place that knows the difference. A
 * line becomes a radar outline, an area becomes a filled radar polygon, and a
 * bar becomes a wedge, from the same series definitions and the same data.
 *
 * # Sizing
 *
 * `width` / `height` are USER UNITS and go straight into the `viewBox`, so the
 * geometry is a pure function of state: no layout read, no `ResizeObserver`, and
 * an SSR render produces the same markup as the client. A consumer who wants
 * true 1:1 pixels observes its own container and dispatches `setSize`; the
 * default is a fixed box that CSS scales, which is correct everywhere and exact
 * where it matters.
 */

export type { ChartCoord }
export type MarkType = 'line' | 'area' | 'bar'

/**
 * How the INDEPENDENT axis is allocated — and therefore which of a chart's two
 * normalized coordinates carries the magnitude.
 *
 * `value` gives every category an equal slot and reads magnitude off `v`: a
 * column, a line, a radar spoke. `share` allocates each category a slot in
 * PROPORTION to its value and lets `v` span the whole depth, so the magnitude
 * has moved onto `u`.
 *
 * That one move is the whole of a pie chart, which is why neither a `'pie'`
 * mark type nor a second projection exists here. Under `coord: 'polar'` a
 * share-allocated bar IS a pie or donut wedge; under `coord: 'cartesian'` the
 * SAME state is a single full-width 100%-share bar, which is the honest
 * cartesian reading of the same numbers. Switching `coord` still re-projects
 * one dataset rather than swapping charts — see
 * `docs/adr/0003-charts-project-rather-than-branch.md`.
 */
export type ChartDomain = 'value' | 'share'

export interface ChartSeries {
  /** Stable key. Also the `--color-<key>` variable a skin reads. */
  key: string
  /** Human label, used by the legend, the tooltip and the a11y table. */
  label: string
  mark: MarkType
  /** Ignored by a polar projection, which supports `linear` only. */
  curve?: Curve
}

/** One row of the independent axis: a category and its value per series. */
export interface ChartRow {
  label: string
  values: Record<string, number>
}

export interface ChartPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ChartState {
  coord: ChartCoord
  /**
   * Equal slots per category (`value`), or slots proportional to the value
   * (`share`). See {@link ChartDomain}; `share` + `coord: 'polar'` is a pie.
   *
   * Under `share` only `bar` series are drawn: a line or an area along an axis
   * whose spacing already encodes the magnitude would plot each point at a
   * position that means something other than where it sits, so they are
   * DECLINED rather than approximated — the same call `polarProjection` makes
   * about `monotone`. `stacked` is ignored for the same reason, each category
   * being its own slice already.
   */
  domain: ChartDomain
  series: ChartSeries[]
  rows: ChartRow[]
  /** Accessible name for the whole chart. */
  label: string
  /** Longer description, announced with the name. */
  description: string
  width: number
  height: number
  padding: ChartPadding
  /**
   * Explicit value-axis bounds. UNBOUNDED-CAPABLE in the sense of `finiteBound`
   * (#177): "derive it" is spelled by OMITTING the key, never by `undefined`,
   * `null` or `±Infinity` — only the omission survives a JSON round trip
   * unchanged.
   */
  min?: number
  max?: number
  tickCount: number
  /** Stack series instead of overlaying them. */
  stacked: boolean
  /** Row index under the pointer or the keyboard cursor. */
  activeIndex: number | null
  /** Series key the legend has isolated, or `null` for all. */
  activeSeries: string | null
  /** Polar only: inner radius as a fraction of the outer (0 = pie, .5 = donut). */
  innerRadius: number
  /** Cartesian only: swap the axes for a horizontal bar chart. */
  horizontal: boolean
}

export type ChartMsg =
  /** @intent("Switch between cartesian and polar projection") */
  | { type: 'setCoord'; coord: ChartCoord }
  /** @intent("Allocate the independent axis by equal slots or by share of the total") */
  | { type: 'setDomain'; domain: ChartDomain }
  /** @intent("Set the row under the cursor, or clear it with null") */
  | { type: 'setActive'; index: number | null }
  /** @intent("Move the keyboard cursor along the rows by delta, wrapping") */
  | { type: 'moveActive'; delta: number }
  /** @intent("Move the keyboard cursor to the first row") */
  | { type: 'firstActive' }
  /** @intent("Move the keyboard cursor to the last row") */
  | { type: 'lastActive' }
  /** @intent("Isolate one series, or show them all again with null") */
  | { type: 'setActiveSeries'; key: string | null }
  /** @intent("Replace the plotted rows") */
  | { type: 'setRows'; rows: ChartRow[] }
  /** @intent("Pin the low end of the value axis, or derive it again with null") */
  | { type: 'setMin'; value: number | null }
  /** @intent("Pin the high end of the value axis, or derive it again with null") */
  | { type: 'setMax'; value: number | null }
  /** @intent("Stack the series instead of overlaying them") */
  | { type: 'setStacked'; stacked: boolean }
  /** @intent("Set the viewBox size in user units") */
  | { type: 'setSize'; width: number; height: number }
  /** @intent("Set the polar inner radius as a fraction of the outer") */
  | { type: 'setInnerRadius'; value: number }
  /** @intent("Swap the cartesian axes for a horizontal bar chart") */
  | { type: 'setHorizontal'; horizontal: boolean }

export interface ChartInit {
  series: readonly ChartSeries[]
  rows?: readonly ChartRow[]
  coord?: ChartCoord
  domain?: ChartDomain
  label?: string
  description?: string
  width?: number
  height?: number
  padding?: Partial<ChartPadding>
  min?: number
  max?: number
  tickCount?: number
  stacked?: boolean
  innerRadius?: number
  horizontal?: boolean
}

const DEFAULT_PADDING: ChartPadding = { top: 12, right: 12, bottom: 28, left: 44 }

export function init(opts: ChartInit): ChartState {
  const state: ChartState = {
    coord: opts.coord ?? 'cartesian',
    domain: opts.domain ?? 'value',
    series: opts.series.map((s) => ({ ...s })),
    rows: (opts.rows ?? []).map((r) => ({ label: r.label, values: { ...r.values } })),
    label: opts.label ?? 'Chart',
    description: opts.description ?? '',
    width: positiveFiniteOrDefault(opts.width, 640),
    height: positiveFiniteOrDefault(opts.height, 320),
    padding: { ...DEFAULT_PADDING, ...opts.padding },
    tickCount: positiveFiniteOrDefault(opts.tickCount, 5),
    stacked: opts.stacked ?? false,
    activeIndex: null,
    activeSeries: null,
    innerRadius: clamp01(opts.innerRadius ?? 0),
    horizontal: opts.horizontal ?? false,
  }
  // OMIT rather than assign `undefined`: the state shape must round-trip
  // through JSON key-for-key (#177).
  const min = finiteBound(opts.min)
  if (min !== undefined) state.min = min
  const max = finiteBound(opts.max)
  if (max !== undefined) state.max = max
  return state
}

function clamp01(n: number): number {
  if (!isFinite(n)) return 0
  return n < 0 ? 0 : n > 0.95 ? 0.95 : n
}

/** Set or REMOVE an optional bound, keeping the omit-don't-assign rule in one
 *  place so no reducer has to remember it. */
function withBound(state: ChartState, key: 'min' | 'max', raw: number | null): ChartState {
  const value = finiteBound(raw)
  const next = { ...state }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

export function update(state: ChartState, msg: ChartMsg): [ChartState, never[]] {
  switch (msg.type) {
    case 'setCoord':
      return state.coord === msg.coord ? [state, []] : [{ ...state, coord: msg.coord }, []]
    case 'setDomain':
      return state.domain === msg.domain ? [state, []] : [{ ...state, domain: msg.domain }, []]
    case 'setActive': {
      if (msg.index === null) {
        return state.activeIndex === null ? [state, []] : [{ ...state, activeIndex: null }, []]
      }
      if (!allFiniteNumbers(msg.index)) return [state, []]
      if (state.rows.length === 0) return [state, []]
      const index = Math.min(Math.max(Math.round(msg.index), 0), state.rows.length - 1)
      return state.activeIndex === index ? [state, []] : [{ ...state, activeIndex: index }, []]
    }
    case 'moveActive': {
      if (!allFiniteNumbers(msg.delta) || state.rows.length === 0) return [state, []]
      // From "nothing active", a forward move lands on the first row and a
      // backward move on the last — the same rule every roving list here uses.
      const from = state.activeIndex ?? (msg.delta >= 0 ? -1 : 0)
      return [{ ...state, activeIndex: wrapIndex(from + msg.delta, state.rows.length) }, []]
    }
    case 'firstActive':
      return state.rows.length === 0 ? [state, []] : [{ ...state, activeIndex: 0 }, []]
    case 'lastActive':
      return state.rows.length === 0
        ? [state, []]
        : [{ ...state, activeIndex: state.rows.length - 1 }, []]
    case 'setActiveSeries': {
      if (msg.key !== null && !state.series.some((s) => s.key === msg.key)) return [state, []]
      return state.activeSeries === msg.key
        ? [state, []]
        : [{ ...state, activeSeries: msg.key }, []]
    }
    case 'setRows': {
      if (!allFiniteNumbers(msg.rows)) return [state, []]
      const rows = msg.rows.map((r) => ({ label: r.label, values: { ...r.values } }))
      // An active index past the new end is not "clamped", it is STALE: the row
      // it named is gone, so the cursor clears rather than jumping to a
      // neighbour the user never selected.
      const activeIndex =
        state.activeIndex !== null && state.activeIndex < rows.length ? state.activeIndex : null
      return [{ ...state, rows, activeIndex }, []]
    }
    case 'setMin':
      return [withBound(state, 'min', msg.value), []]
    case 'setMax':
      return [withBound(state, 'max', msg.value), []]
    case 'setStacked':
      return state.stacked === msg.stacked ? [state, []] : [{ ...state, stacked: msg.stacked }, []]
    case 'setSize': {
      if (!allFiniteNumbers(msg.width, msg.height)) return [state, []]
      if (!(msg.width > 0) || !(msg.height > 0)) return [state, []]
      if (state.width === msg.width && state.height === msg.height) return [state, []]
      return [{ ...state, width: msg.width, height: msg.height }, []]
    }
    case 'setInnerRadius': {
      const value = clamp01(msg.value)
      return state.innerRadius === value ? [state, []] : [{ ...state, innerRadius: value }, []]
    }
    case 'setHorizontal':
      return state.horizontal === msg.horizontal
        ? [state, []]
        : [{ ...state, horizontal: msg.horizontal }, []]
  }
}

// ── Derived geometry ──────────────────────────────────────────────────────
//
// Everything below is a PURE function of state and lives nowhere in it. The
// derivation is memoized on state identity (`deriveOnce`), the same way
// `date-picker` memoizes its day grid: one computation per update, shared by
// every binding that reads it.

/** A drawn mark: one series, one path. */
export interface ChartMark {
  seriesKey: string
  label: string
  mark: MarkType
  /** The SVG path `d`. */
  d: string
  /** Row index, for a `bar`/wedge — `null` for a whole-series line or area. */
  index: number | null
  active: boolean
  dimmed: boolean
}

/** A vertex on a line or area series, for the dot layer and hit feedback. */
export interface ChartVertex {
  seriesKey: string
  index: number
  x: number
  y: number
  active: boolean
}

export interface ChartGridLine {
  value: number
  label: string
  d: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  baseline: 'auto' | 'middle' | 'hanging'
}

export interface ChartCategoryTick {
  index: number
  label: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  baseline: 'auto' | 'middle' | 'hanging'
  active: boolean
}

export interface ChartTooltipRow {
  seriesKey: string
  label: string
  value: number
  /**
   * The row's fraction of its series' total under a share domain — what a pie
   * tooltip shows as a percentage — and `null` under a value domain, where a
   * share of an axis that may cross zero is not defined.
   */
  share: number | null
}

export interface ChartGeometry {
  frame: Frame
  domain: Domain
  band: Band
  /**
   * The proportional allocation of the independent axis under
   * `ChartState.domain === 'share'`, and `null` otherwise. It is the axis
   * itself, not a decoration: the pointer hit test reads it instead of `band`.
   *
   * With more than one bar series each ring gets its OWN allocation from its
   * own values — that is what makes a nested donut's rings each proportional —
   * so a single `u` names different rows on different rings and the pointer
   * has to follow one of them. It follows the FIRST bar series, which is the
   * whole story for the single-series pie that is the common case.
   */
  slices: ShareSlice[] | null
  projection: Projection
  marks: ChartMark[]
  vertices: ChartVertex[]
  gridLines: ChartGridLine[]
  categoryTicks: ChartCategoryTick[]
  /** Anchor for the tooltip, in user units. `null` when nothing is active. */
  tooltipAt: { x: number; y: number } | null
  tooltipRows: ChartTooltipRow[]
}

function frameOf(state: ChartState): Frame {
  const { padding } = state
  // A polar chart has no axis gutters to reserve, so it uses the whole box —
  // reserving cartesian padding there just shrinks the circle off-centre.
  if (state.coord === 'polar') {
    const inset = Math.min(padding.top, padding.right, padding.bottom, padding.left)
    return {
      x: inset,
      y: inset,
      width: Math.max(0, state.width - inset * 2),
      height: Math.max(0, state.height - inset * 2),
    }
  }
  return {
    x: padding.left,
    y: padding.top,
    width: Math.max(0, state.width - padding.left - padding.right),
    height: Math.max(0, state.height - padding.top - padding.bottom),
  }
}

function bandOf(state: ChartState): Band {
  // A share axis carries the magnitude in its own spacing, so its slots may not
  // be padded — see `shareExtents`. `band` is still built (category ticks and
  // the tooltip anchor read it when there is nothing to allocate), but with the
  // gaps off so a fallback can never restate the data.
  const hasBars = state.domain === 'value' && state.series.some((s) => s.mark === 'bar')
  return {
    count: state.rows.length,
    // A line's samples sit at band CENTRES, so padding only changes where the
    // first and last vertex land. Bars need real gaps between them.
    paddingInner: hasBars ? 0.25 : 0,
    paddingOuter: hasBars ? 0.15 : 0,
  }
}

function seriesValue(row: ChartRow, key: string): number {
  const raw = row.values[key]
  return typeof raw === 'number' && isFinite(raw) ? raw : 0
}

/**
 * Per-row cumulative offsets when stacking. Returns `[base, top]` in DATA
 * units for every (row, series) pair, so the same code draws a stacked bar and
 * a stacked area.
 */
function stackOffsets(state: ChartState): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>()
  for (const s of state.series) out.set(s.key, [])
  for (const row of state.rows) {
    let positive = 0
    let negative = 0
    for (const s of state.series) {
      const value = seriesValue(row, s.key)
      if (!state.stacked) {
        out.get(s.key)!.push([0, value])
        continue
      }
      if (value >= 0) {
        out.get(s.key)!.push([positive, positive + value])
        positive += value
      } else {
        out.get(s.key)!.push([negative, negative + value])
        negative += value
      }
    }
  }
  return out
}

const geometryOf = deriveOnce((state: ChartState): ChartGeometry => {
  const frame = frameOf(state)
  const band = bandOf(state)
  const offsets = stackOffsets(state)
  const visible = state.series.filter(
    (s) => state.activeSeries === null || s.key === state.activeSeries,
  )

  const spread: number[] = []
  for (const s of state.series) {
    for (const [base, top] of offsets.get(s.key)!) {
      spread.push(base, top)
    }
  }
  const domain = valueDomain(spread, {
    min: state.min,
    max: state.max,
    tickCount: state.tickCount,
  })

  const projection = projectionFor(state.coord, frame, {
    innerRadius: state.innerRadius,
    horizontal: state.horizontal,
    grid: state.series.some((s) => s.mark === 'bar') ? 'ring' : 'web',
    spokes: Math.max(3, state.rows.length),
  })

  // Under a share domain every bar series allocates the axis from its OWN row
  // values, so each ring of a nested donut is proportional to itself. The
  // pointer follows the first of them — see `ChartGeometry.slices`.
  const shareOf = new Map<string, ShareSlice[]>()
  if (state.domain === 'share') {
    for (const s of state.series) {
      if (s.mark !== 'bar') continue
      shareOf.set(s.key, shareExtents(state.rows.map((row) => seriesValue(row, s.key))))
    }
  }
  const shareKeys = [...shareOf.keys()]
  const slices = shareKeys.length > 0 ? shareOf.get(shareKeys[0]!)! : null

  const zeroV = normalize(0, domain)
  const marks: ChartMark[] = []
  const vertices: ChartVertex[] = []

  // Unstacked bar series sit SIDE BY SIDE inside each category's band, not on
  // top of one another. Overlaying them hides the shorter series completely —
  // it also reads as a stacked chart, so the picture is not merely incomplete,
  // it says something false about the numbers.
  const barKeys = state.series.filter((s) => s.mark === 'bar').map((s) => s.key)
  const groupCount = state.stacked ? 1 : Math.max(1, barKeys.length)

  for (const s of state.series) {
    const dimmed = state.activeSeries !== null && s.key !== state.activeSeries
    const pairs = offsets.get(s.key)!

    const mySlices = shareOf.get(s.key)
    if (state.domain === 'share') {
      // A line or an area along an axis whose SPACING already states the
      // magnitude would put every point at a position meaning something other
      // than where it sits. Declined, not approximated.
      if (mySlices === undefined) continue
      // Each bar series owns a depth slot, so two of them are concentric rings
      // rather than one drawn over the other. One series fills the whole depth,
      // which is the plain pie.
      const ring = Math.max(0, shareKeys.indexOf(s.key))
      const v0 = ring / shareKeys.length
      const v1 = (ring + 1) / shareKeys.length
      for (let i = 0; i < state.rows.length; i++) {
        const slice = mySlices[i]
        // A zero-share row has no wedge. Emitting an empty band would put a
        // degenerate path in the DOM and a hit target on nothing.
        if (slice === undefined || slice.share <= 0) continue
        marks.push({
          seriesKey: s.key,
          label: s.label,
          mark: 'bar',
          d: projection.band(slice.start, slice.end, v0, v1),
          index: i,
          active: state.activeIndex === i,
          dimmed,
        })
      }
      continue
    }

    if (s.mark === 'bar') {
      // The slot stays reserved when a series is hidden, so isolating one from
      // the legend moves nothing.
      const slot = state.stacked ? 0 : Math.max(0, barKeys.indexOf(s.key))
      // One mark per row — a bar is a band, and a band is a wedge in polar.
      for (let i = 0; i < state.rows.length; i++) {
        const [base, top] = pairs[i] ?? [0, 0]
        const [bandStart, bandEnd] = bandExtent(i, band)
        const width = (bandEnd - bandStart) / groupCount
        const u0 = bandStart + slot * width
        marks.push({
          seriesKey: s.key,
          label: s.label,
          mark: 'bar',
          d: projection.band(u0, u0 + width, normalize(base, domain), normalize(top, domain)),
          index: i,
          active: state.activeIndex === i,
          dimmed,
        })
      }
      continue
    }
    const upper: Sample[] = []
    const lower: Sample[] = []
    for (let i = 0; i < state.rows.length; i++) {
      const [base, top] = pairs[i] ?? [0, 0]
      const u = bandCenter(i, band)
      upper.push({ u, v: normalize(top, domain) })
      lower.push({ u, v: state.stacked ? normalize(base, domain) : zeroV })
    }
    const curve = s.curve ?? 'linear'
    marks.push({
      seriesKey: s.key,
      label: s.label,
      mark: s.mark,
      d: s.mark === 'area' ? projection.area(upper, lower, curve) : projection.line(upper, curve),
      index: null,
      active: false,
      dimmed,
    })
    for (let i = 0; i < upper.length; i++) {
      const p = projection.point(upper[i]!.u, upper[i]!.v)
      vertices.push({
        seriesKey: s.key,
        index: i,
        x: p.x,
        y: p.y,
        active: state.activeIndex === i,
      })
    }
  }

  // A share axis HAS no value axis — the magnitude is the spacing, so an
  // iso-magnitude ring would be a line of constant depth, which states nothing
  // about the data. Emitting them anyway is how a pie ends up with concentric
  // rings across it that a reader tries to interpret.
  const gridLines: ChartGridLine[] =
    state.domain === 'share'
      ? []
      : niceTicks(domain.min, domain.max, state.tickCount).map((value) => {
          const v = normalize(value, domain)
          const at = projection.valueTick(v)
          return {
            value,
            label: formatTick(value),
            d: projection.gridline(v),
            x: at.x,
            y: at.y,
            anchor: at.anchor,
            baseline: at.baseline,
          }
        })

  // A category label belongs at the middle of whatever the category actually
  // occupies — an equal slot, or its own slice. A zero-share row occupies
  // nothing, so it gets no label rather than one stacked on the seam with
  // every other empty row's.
  const categoryTicks: ChartCategoryTick[] = []
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i]!
    let u: number
    if (slices !== null) {
      const slice = slices[i]
      if (slice === undefined || slice.share <= 0) continue
      u = (slice.start + slice.end) / 2
    } else {
      u = bandCenter(i, band)
    }
    const at = projection.tick(u)
    categoryTicks.push({
      index: i,
      label: row.label,
      x: at.x,
      y: at.y,
      anchor: at.anchor,
      baseline: at.baseline,
      active: state.activeIndex === i,
    })
  }

  const activeRow = state.activeIndex !== null ? state.rows[state.activeIndex] : undefined
  const tooltipRows: ChartTooltipRow[] =
    activeRow === undefined
      ? []
      : visible.map((s) => {
          // Each series' own allocation, so a nested donut reports the share
          // the ring under the pointer is actually drawing.
          const own = shareOf.get(s.key)
          const slice = state.activeIndex !== null ? own?.[state.activeIndex] : undefined
          return {
            seriesKey: s.key,
            label: s.label,
            value: seriesValue(activeRow, s.key),
            share: slice === undefined ? null : slice.share,
          }
        })

  let tooltipAt: { x: number; y: number } | null = null
  if (state.activeIndex !== null && activeRow !== undefined) {
    if (slices !== null) {
      // Mid-slice, mid-depth: the wedge's own centre. There is no "tallest
      // value" to clear here — every slice spans the full depth.
      const slice = slices[state.activeIndex]
      if (slice !== undefined && slice.share > 0) {
        const p = projection.point((slice.start + slice.end) / 2, 0.5)
        tooltipAt = { x: p.x, y: p.y }
      }
    } else {
      const u = bandCenter(state.activeIndex, band)
      // Anchor at the TALLEST visible value in the row, so the tooltip never
      // sits under the mark it describes.
      let bestV = zeroV
      for (const s of visible) {
        const [, top] = offsets.get(s.key)![state.activeIndex] ?? [0, 0]
        bestV = Math.max(bestV, normalize(top, domain))
      }
      const p = projection.point(u, bestV)
      tooltipAt = { x: p.x, y: p.y }
    }
  }

  return {
    frame,
    domain,
    band,
    slices,
    projection,
    marks,
    vertices,
    gridLines,
    categoryTicks,
    tooltipAt,
    tooltipRows,
  }
})

/** Trim the float noise `min + k * step` accumulates, without imposing a
 *  locale or a currency the consumer has not asked for. */
function formatTick(value: number): string {
  const rounded = Number(value.toFixed(6))
  return String(rounded === 0 ? 0 : rounded)
}

/** The derived geometry for a state. Exported so a consumer can measure or test
 *  a chart without mounting one. */
export function geometry(state: ChartState): ChartGeometry {
  return geometryOf(state)
}

// ── connect ───────────────────────────────────────────────────────────────

export interface ChartParts {
  root: {
    'data-scope': 'chart'
    'data-part': 'root'
    // Spelled out rather than aliased: `scripts/test/registry-attrs.test.ts`
    // reads part-bag VALUES syntactically, and an imported alias reads as an
    // open type it declines to give a verdict on.
    'data-coord': Signal<'cartesian' | 'polar'>
    'data-domain': Signal<'value' | 'share'>
    'data-active': Signal<'' | undefined>
  }
  /**
   * The `<svg>`. `role="img"` with a name and description is what a screen
   * reader announces; the real data path is {@link ChartParts.table}, because
   * AT support for the WAI-ARIA graphics roles is still thin enough that a
   * chart relying on them alone is unreadable.
   *
   * `tabindex="0"` makes the plot itself the keyboard target: arrows walk the
   * rows, Home/End jump to the ends, Escape clears. There is no
   * `aria-activedescendant` — it is not valid on `role="img"`, and the tooltip
   * live region is what actually announces the cursor.
   */
  svg: {
    'data-scope': 'chart'
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
  title: { id: string; 'data-scope': 'chart'; 'data-part': 'title' }
  desc: { id: string; 'data-scope': 'chart'; 'data-part': 'desc' }
  /** The visually-hidden `<table>` fallback. Render it with the rows below. */
  table: {
    'data-scope': 'chart'
    'data-part': 'table'
    'aria-label': Signal<string>
  }
  /** Tooltip ATTRIBUTES — spreadable, with its own reactive `hidden`. */
  tooltip: {
    'data-scope': 'chart'
    'data-part': 'tooltip'
    role: 'status'
    'aria-live': 'polite'
    hidden: Signal<boolean>
    style: Signal<string>
  }
  /** A `<g>` stacking layer. Static — spread it on each layer group. */
  layer: { 'data-scope': 'chart'; 'data-part': 'layer' }
  /** A value gridline. Pass `d` from the {@link ChartGridLine}. */
  grid: { 'data-scope': 'chart'; 'data-part': 'grid' }
  /** An axis label — value ticks and category names. */
  axisLabel: { 'data-scope': 'chart'; 'data-part': 'axis-label' }
  /** Attributes for one vertex dot on a line or area series. */
  dotProps: (vertex: ChartVertex) => {
    'data-scope': 'chart'
    'data-part': 'dot'
    'data-series': string
    'data-active': '' | undefined
    cx: number
    cy: number
  }
  legendItem: (key: string) => {
    type: 'button'
    'data-scope': 'chart'
    'data-part': 'legend-item'
    'data-series': string
    'data-dimmed': Signal<'' | undefined>
    'aria-pressed': Signal<boolean>
    onClick: (e: MouseEvent) => void
  }
  /** Attributes for one drawn mark. Spread onto a `<path>` and pass `d`. */
  markProps: (mark: ChartMark) => {
    'data-scope': 'chart'
    'data-part': 'mark'
    'data-mark': 'line' | 'area' | 'bar'
    'data-series': string
    'data-active': '' | undefined
    'data-dimmed': '' | undefined
    d: string
    onPointerEnter: (e: PointerEvent) => void
  }
  // Derived geometry, as signals the view renders with `each`.
  marks: Signal<ChartMark[]>
  vertices: Signal<ChartVertex[]>
  gridLines: Signal<ChartGridLine[]>
  categoryTicks: Signal<ChartCategoryTick[]>
  tooltipRows: Signal<ChartTooltipRow[]>
  activeLabel: Signal<string>
  rows: Signal<ChartRow[]>
  series: Signal<ChartSeries[]>
}

export interface ChartConnectOptions {
  /** Base id; the title and description ids derive from it. */
  id: string
}

export function connect(
  state: Signal<ChartState>,
  send: Send<ChartMsg>,
  opts: ChartConnectOptions,
): ChartParts {
  const titleId = `${opts.id}:title`
  const descId = `${opts.id}:desc`

  /**
   * Pointer → row. The event's `offsetX/Y` are in CSS pixels of the rendered
   * box, and the geometry is in viewBox units, so the two are related by the
   * element's own scale — read it from the live element rather than assuming
   * they match, or every hit test is wrong the moment CSS resizes the chart.
   */
  const rowAt = (e: PointerEvent): number | null => {
    const el = e.currentTarget as SVGSVGElement | null
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const s = state.peek()
    const x = ((e.clientX - rect.left) / rect.width) * s.width
    const y = ((e.clientY - rect.top) / rect.height) * s.height
    const geo = geometry(s)
    const u = geo.projection.locate(x, y)
    if (u === null) return null
    // A share axis tiles with no gaps, so the slice CONTAINING the pointer is
    // exact. Falling back to nearest-centre here would hand a thin wedge's own
    // interior to the wide one beside it.
    return geo.slices !== null ? nearestShare(u, geo.slices) : nearestBand(u, geo.band)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const s = state.peek()
    if (s.rows.length === 0) return
    // In polar the independent axis runs AROUND, so both arrow pairs advance
    // it; in cartesian only the axis the chart is laid out along does.
    const forward = s.coord === 'polar' || !s.horizontal ? 'ArrowRight' : 'ArrowDown'
    const backward = s.coord === 'polar' || !s.horizontal ? 'ArrowLeft' : 'ArrowUp'
    const alsoForward = s.coord === 'polar' ? 'ArrowDown' : forward
    const alsoBackward = s.coord === 'polar' ? 'ArrowUp' : backward
    switch (e.key) {
      case forward:
      case alsoForward:
        e.preventDefault()
        send({ type: 'moveActive', delta: 1 })
        return
      case backward:
      case alsoBackward:
        e.preventDefault()
        send({ type: 'moveActive', delta: -1 })
        return
      case 'Home':
        e.preventDefault()
        send({ type: 'firstActive' })
        return
      case 'Escape':
        if (s.activeIndex === null) return
        e.preventDefault()
        send({ type: 'setActive', index: null })
        return
      case 'End':
        e.preventDefault()
        send({ type: 'lastActive' })
        return
      default:
    }
  }

  return {
    root: {
      'data-scope': 'chart',
      'data-part': 'root',
      'data-coord': state.map((s) => s.coord),
      'data-domain': state.map((s) => s.domain),
      'data-active': state.map((s) => (s.activeIndex !== null ? '' : undefined)),
    },
    svg: {
      'data-scope': 'chart',
      'data-part': 'svg',
      role: 'img',
      'aria-labelledby': `${titleId} ${descId}`,
      viewBox: state.map((s) => `0 0 ${s.width} ${s.height}`),
      tabindex: 0,
      onKeyDown: tagSend(send, ['moveActive', 'firstActive', 'lastActive', 'setActive'], onKeyDown),
      onPointerMove: tagSend(send, ['setActive'], (e: PointerEvent) => {
        const index = rowAt(e)
        if (index !== null) send({ type: 'setActive', index })
      }),
      onPointerLeave: tagSend(send, ['setActive'], () => send({ type: 'setActive', index: null })),
      onBlur: tagSend(send, ['setActive'], () => send({ type: 'setActive', index: null })),
    },
    title: { id: titleId, 'data-scope': 'chart', 'data-part': 'title' },
    desc: { id: descId, 'data-scope': 'chart', 'data-part': 'desc' },
    table: {
      'data-scope': 'chart',
      'data-part': 'table',
      'aria-label': state.map((s) => s.label),
    },
    tooltip: {
      'data-scope': 'chart',
      'data-part': 'tooltip',
      role: 'status',
      'aria-live': 'polite',
      hidden: state.map((s) => s.activeIndex === null),
      // Percentages of the viewBox, so the tooltip tracks the mark under any
      // CSS size without a second measurement.
      style: state.map((s) => {
        const at = geometry(s).tooltipAt
        if (at === null) return 'display:none'
        const left = s.width === 0 ? 0 : (at.x / s.width) * 100
        const top = s.height === 0 ? 0 : (at.y / s.height) * 100
        return `left:${left}%;top:${top}%`
      }),
    },
    layer: { 'data-scope': 'chart', 'data-part': 'layer' },
    grid: { 'data-scope': 'chart', 'data-part': 'grid' },
    axisLabel: { 'data-scope': 'chart', 'data-part': 'axis-label' },
    dotProps: (vertex) => ({
      'data-scope': 'chart',
      'data-part': 'dot',
      'data-series': vertex.seriesKey,
      'data-active': vertex.active ? '' : undefined,
      cx: vertex.x,
      cy: vertex.y,
    }),
    legendItem: (key) => ({
      type: 'button',
      'data-scope': 'chart',
      'data-part': 'legend-item',
      'data-series': key,
      'data-dimmed': state.map((s) =>
        s.activeSeries !== null && s.activeSeries !== key ? '' : undefined,
      ),
      'aria-pressed': state.map((s) => s.activeSeries === key),
      onClick: tagSend(send, ['setActiveSeries'], () => {
        const s = state.peek()
        send({ type: 'setActiveSeries', key: s.activeSeries === key ? null : key })
      }),
    }),
    markProps: (mark) => ({
      'data-scope': 'chart',
      'data-part': 'mark',
      'data-mark': mark.mark,
      'data-series': mark.seriesKey,
      'data-active': mark.active ? '' : undefined,
      'data-dimmed': mark.dimmed ? '' : undefined,
      d: mark.d,
      onPointerEnter: tagSend(send, ['setActive'], () => {
        if (mark.index !== null) send({ type: 'setActive', index: mark.index })
      }),
    }),
    marks: state.map((s) => geometry(s).marks),
    vertices: state.map((s) => geometry(s).vertices),
    gridLines: state.map((s) => geometry(s).gridLines),
    categoryTicks: state.map((s) => geometry(s).categoryTicks),
    tooltipRows: state.map((s) => geometry(s).tooltipRows),
    activeLabel: state.map((s) =>
      s.activeIndex === null ? '' : (s.rows[s.activeIndex]?.label ?? ''),
    ),
    rows: state.map((s) => s.rows),
    series: state.map((s) => s.series),
  }
}

export const chart = { init, update, connect, geometry }
