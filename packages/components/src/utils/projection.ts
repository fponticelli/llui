/**
 * Projection — the ONE seam between a cartesian chart and a polar one.
 *
 * A chart is two things: data mapped into normalized space (`scale.ts`, which
 * knows no pixels), and normalized space mapped onto the screen. Everything
 * that differs between a bar chart and a pie chart, or a line chart and a
 * radar, lives in the SECOND mapping and nowhere else. So it gets an interface,
 * two implementations, and no other code in the package is allowed to know
 * which one it has.
 *
 * The coordinates are always the same pair:
 *
 * - `u` ∈ [0, 1] — position along the INDEPENDENT axis. Cartesian: left to
 *   right. Polar: clockwise from 12 o'clock.
 * - `v` ∈ [0, 1] — MAGNITUDE along the dependent axis. Cartesian: bottom to
 *   top. Polar: inner radius to outer.
 *
 * With that, one mark implementation serves both coordinate systems:
 *
 * | mark      | cartesian          | polar                    |
 * | --------- | ------------------ | ------------------------ |
 * | `line`    | a polyline         | a radar outline          |
 * | `area`    | a filled band      | a filled radar polygon   |
 * | `band`    | a bar (rect)       | a wedge (annular sector) |
 * | gridline  | a horizontal rule  | a ring, or a radar web   |
 *
 * `chart.ts` calls `point` / `line` / `area` / `band` / `gridline` / `tick` and
 * never branches on `kind`. Switching a chart between coordinate systems is one
 * message, and every mark, gridline, tick, hit test and tooltip follows.
 */

import {
  annularSectorPath,
  areaPath,
  circlePath,
  curvePath,
  linearPath,
  polarPoint,
  rectPath,
  type Curve,
  type CurveAxis,
  type Point,
} from './path.js'
import type { Sample } from './scale.js'

export type ChartCoord = 'cartesian' | 'polar'

/** The plot area in user units — the box marks are drawn inside, already
 *  inset by whatever padding the axes need. */
export interface Frame {
  x: number
  y: number
  width: number
  height: number
}

/** Where an independent-axis tick label sits, and how to align it there. */
export interface TickPlacement {
  x: number
  y: number
  /** SVG `text-anchor`. */
  anchor: 'start' | 'middle' | 'end'
  /** SVG `dominant-baseline`. */
  baseline: 'auto' | 'middle' | 'hanging'
}

export interface Projection {
  readonly kind: ChartCoord
  /**
   * Whether the independent axis is a CLOSED loop. `true` for a polar
   * projection covering a full turn, which is what makes a radar outline join
   * back to its first vertex instead of leaving a gap.
   */
  readonly closed: boolean
  /**
   * Curves this projection can honour. A caller asking for one outside the set
   * gets `linear` — see the polar note below for why this is the honest answer
   * rather than a silent approximation.
   */
  readonly curves: readonly Curve[]
  /** Normalized (u, v) → a point in user units. */
  point(u: number, v: number): Point
  /** A run of samples joined along increasing `u`. */
  line(samples: readonly Sample[], curve: Curve): string
  /** The region between an upper run and a lower run of the same length. */
  area(upper: readonly Sample[], lower: readonly Sample[], curve: Curve): string
  /** A band spanning `u0..u1` and `v0..v1`: a bar, or a wedge. */
  band(u0: number, u1: number, v0: number, v1: number): string
  /** The iso-magnitude line at `v` — a value gridline. */
  gridline(v: number): string
  /** Where the independent-axis tick for `u` belongs. */
  tick(u: number): TickPlacement
  /** Where the DEPENDENT-axis tick for `v` belongs. */
  valueTick(v: number): TickPlacement
  /**
   * Invert a point in user units back to `u`, for pointer hit testing. Returns
   * `null` when the point carries no meaningful `u` — the exact centre of a
   * polar chart, where every angle is equally close.
   */
  locate(x: number, y: number): number | null
}

/** Resolve a requested curve against what a projection supports. */
function resolveCurve(p: Pick<Projection, 'curves'>, curve: Curve): Curve {
  return p.curves.includes(curve) ? curve : 'linear'
}

// ── Cartesian ─────────────────────────────────────────────────────────────

export interface CartesianOptions {
  /** Swap the axes: `u` runs top-to-bottom and `v` left-to-right. This is what
   *  turns a column chart into a horizontal bar chart, and it is a PROJECTION
   *  concern — no mark, scale or hit test changes. */
  horizontal?: boolean
}

export function cartesianProjection(frame: Frame, opts: CartesianOptions = {}): Projection {
  const horizontal = opts.horizontal ?? false
  const point = (u: number, v: number): Point =>
    horizontal
      ? { x: frame.x + v * frame.width, y: frame.y + u * frame.height }
      : { x: frame.x + u * frame.width, y: frame.y + (1 - v) * frame.height }

  const toPoints = (samples: readonly Sample[]): Point[] => samples.map((s) => point(s.u, s.v))
  // `horizontal` moves the INDEPENDENT axis from x to y, and `monotone`/`step`
  // are both defined as a function of it. Leaving them on x offsets every
  // control point along the wrong axis — see `CurveAxis` in `path.ts`.
  const axis: CurveAxis = horizontal ? 'y' : 'x'

  const self: Projection = {
    kind: 'cartesian',
    closed: false,
    curves: ['linear', 'monotone', 'step'],
    point,
    line: (samples, curve) => curvePath(toPoints(samples), resolveCurve(self, curve), false, axis),
    area: (upper, lower, curve) =>
      areaPath(toPoints(upper), toPoints(lower), resolveCurve(self, curve), axis),
    band: (u0, u1, v0, v1) => {
      const a = point(u0, v0)
      const b = point(u1, v1)
      return rectPath(a.x, a.y, b.x, b.y)
    },
    gridline: (v) => {
      const a = point(0, v)
      const b = point(1, v)
      return linearPath([a, b])
    },
    tick: (u) => {
      const p = point(u, 0)
      return horizontal
        ? { x: frame.x, y: p.y, anchor: 'end', baseline: 'middle' }
        : { x: p.x, y: frame.y + frame.height, anchor: 'middle', baseline: 'hanging' }
    },
    valueTick: (v) => {
      const p = point(0, v)
      return horizontal
        ? { x: p.x, y: frame.y + frame.height, anchor: 'middle', baseline: 'hanging' }
        : { x: frame.x, y: p.y, anchor: 'end', baseline: 'middle' }
    },
    locate: (x, y) => {
      const span = horizontal ? frame.height : frame.width
      if (span === 0) return null
      const along = horizontal ? y - frame.y : x - frame.x
      return along / span
    },
  }
  return self
}

// ── Polar ─────────────────────────────────────────────────────────────────

export interface PolarOptions {
  /** Inner radius as a fraction of the outer. `0` is a pie, `0.5` a donut, and
   *  a radar usually wants `0`. */
  innerRadius?: number
  /** Where `u = 0` sits, in radians clockwise from 12 o'clock. */
  startAngle?: number
  /** Total sweep in radians. Defaults to a full turn, which is what makes the
   *  projection `closed`. */
  sweep?: number
  /**
   * Gridline shape. `ring` is a circle at the given magnitude — right for a
   * pie or a rose. `web` joins the `spokes` sample positions with straight
   * segments — right for a radar, where a circular grid reads as a different
   * chart from the polygonal data on top of it.
   */
  grid?: 'ring' | 'web'
  /** How many spokes a `web` gridline has. Ignored for `ring`. */
  spokes?: number
}

const TAU = Math.PI * 2

export function polarProjection(frame: Frame, opts: PolarOptions = {}): Projection {
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  const outer = Math.min(frame.width, frame.height) / 2
  const innerFraction = Math.min(Math.max(opts.innerRadius ?? 0, 0), 0.95)
  const inner = outer * innerFraction
  const startAngle = opts.startAngle ?? 0
  const sweep = opts.sweep ?? TAU
  const grid = opts.grid ?? 'ring'
  const spokes = Math.max(3, Math.floor(opts.spokes ?? 6))

  const angleOf = (u: number): number => startAngle + u * sweep
  const radiusOf = (v: number): number => inner + v * (outer - inner)
  const point = (u: number, v: number): Point => polarPoint(cx, cy, radiusOf(v), angleOf(u))

  const toPoints = (samples: readonly Sample[]): Point[] => samples.map((s) => point(s.u, s.v))
  // Only a FULL turn closes. A half-donut gauge must not join its two ends.
  const closed = Math.abs(sweep) >= TAU - 1e-9

  const self: Projection = {
    kind: 'polar',
    closed,
    /**
     * `linear` only, and that is a correctness statement rather than a missing
     * feature. Monotone cubic's defining guarantee — never overshoot between
     * two samples — is defined on a function y = f(x) with increasing x. On a
     * closed angular loop there is no such ordering, so the guarantee does not
     * hold and the curve would draw values nobody measured. `step` has the same
     * problem: its staircase is axis-aligned, and there are no axes here.
     */
    curves: ['linear'],
    point,
    line: (samples, curve) => curvePath(toPoints(samples), resolveCurve(self, curve), closed),
    area: (upper, lower, curve) => {
      const top = toPoints(upper)
      const bottom = toPoints(lower)
      if (top.length === 0) return ''
      const resolved = resolveCurve(self, curve)
      if (!closed) return areaPath(top, bottom, resolved)
      // Closed: each ring is its own subpath, and the fill-rule punches the
      // inner one out. Threading them into a single subpath (what `areaPath`
      // does for the open case) would draw a seam straight across the middle.
      const outerRing = curvePath(top, resolved, true)
      if (bottom.length === 0) return outerRing
      const innerRing = curvePath([...bottom].reverse(), resolved, true)
      return `${outerRing}${innerRing}`
    },
    band: (u0, u1, v0, v1) =>
      annularSectorPath(cx, cy, radiusOf(v0), radiusOf(v1), angleOf(u0), angleOf(u1)),
    gridline: (v) => {
      const r = radiusOf(v)
      if (grid === 'ring') return circlePath(cx, cy, r)
      const vertices: Point[] = []
      for (let i = 0; i < spokes; i++) {
        vertices.push(polarPoint(cx, cy, r, startAngle + (i / spokes) * sweep))
      }
      return linearPath(vertices, closed)
    },
    tick: (u) => {
      // Labels sit just OUTSIDE the plot, and their alignment follows the
      // angle: a label at 3 o'clock reads leftwards from the chart, one at
      // 9 o'clock rightwards. Anchoring them all `middle` overlaps the marks.
      const angle = angleOf(u)
      const p = polarPoint(cx, cy, outer * 1.08, angle)
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      const anchor: TickPlacement['anchor'] =
        Math.abs(sin) < 0.2 ? 'middle' : sin > 0 ? 'start' : 'end'
      const baseline: TickPlacement['baseline'] =
        Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'auto' : 'hanging'
      return { x: p.x, y: p.y, anchor, baseline }
    },
    // Straight up from the centre, where a ring gridline is least crowded.
    valueTick: (v) => ({
      x: cx,
      y: cy - radiusOf(v),
      anchor: 'middle',
      baseline: 'middle',
    }),
    locate: (x, y) => {
      const dx = x - cx
      const dy = y - cy
      if (dx === 0 && dy === 0) return null
      // `atan2(dx, -dy)` measures clockwise from 12 o'clock, matching `angleOf`.
      let angle = Math.atan2(dx, -dy) - startAngle
      if (sweep === 0) return null
      // Normalize into [0, TAU) so a pointer just anticlockwise of the start
      // lands at the END of the range rather than at a negative `u`.
      angle = ((angle % TAU) + TAU) % TAU
      return angle / sweep
    },
  }
  return self
}

/** Build the projection a chart's coordinate setting names. */
export function projectionFor(
  coord: ChartCoord,
  frame: Frame,
  opts: CartesianOptions & PolarOptions = {},
): Projection {
  return coord === 'polar' ? polarProjection(frame, opts) : cartesianProjection(frame, opts)
}
