/**
 * SVG path construction. Pure string building — no DOM, no state.
 *
 * Every number goes through {@link fmt} before it reaches a path. That is not
 * cosmetic: the reconciler commits a binding only when its OUTPUT changes
 * (output-equality), so a path recomputed from unchanged data must produce a
 * BYTE-IDENTICAL string or every mark re-commits on every unrelated state
 * change. Raw float output does not guarantee that — `0.1 + 0.2` reaches a path
 * as `0.30000000000000004` from one code route and `0.3` from another.
 */

/** Fixed precision for path coordinates: sub-pixel at any realistic size, and
 *  stable enough that equal geometry yields an equal string. */
const PRECISION = 3

/** Format a coordinate. A non-finite input becomes 0 — a `NaN` in a path
 *  silently voids the WHOLE path element, taking every later command with it. */
export function fmt(n: number): string {
  if (!isFinite(n)) return '0'
  const rounded = Number(n.toFixed(PRECISION))
  // `-0` and `0` are the same point and must not be two different strings.
  return String(rounded === 0 ? 0 : rounded)
}

export interface Point {
  x: number
  y: number
}

/** How a run of points is joined. */
export type Curve = 'linear' | 'monotone' | 'step'

/**
 * Which coordinate a curve is a FUNCTION OF. `monotone` and `step` are both
 * defined on `w = f(t)` with increasing `t`; this names which of x/y plays `t`.
 *
 * It is not a formatting detail. A horizontal bar/line chart puts the
 * independent axis on y, and running the curve along x regardless offsets every
 * control point along the wrong axis: measured, a four-point series emitted
 * `M150,0C190,25 230,75 270,75`, where the second control already sits at the
 * segment's end instead of two thirds along it. The endpoints stay correct in
 * both orientations, which is why it reads as a smoothing artefact rather than
 * a bug — and why asserting the path advances monotonically catches nothing.
 */
export type CurveAxis = 'x' | 'y'

/** Split a point into (independent, dependent) for the named axis. */
function split(p: Point, axis: CurveAxis): [number, number] {
  return axis === 'y' ? [p.y, p.x] : [p.x, p.y]
}

/** Rebuild a point from (independent, dependent) for the named axis. */
function join(t: number, w: number, axis: CurveAxis): Point {
  return axis === 'y' ? { x: w, y: t } : { x: t, y: w }
}

function moveTo(p: Point): string {
  return `M${fmt(p.x)},${fmt(p.y)}`
}

function lineTo(p: Point): string {
  return `L${fmt(p.x)},${fmt(p.y)}`
}

/** Straight segments through every point. */
export function linearPath(points: readonly Point[], closed = false): string {
  if (points.length === 0) return ''
  const first = points[0]!
  let d = moveTo(first)
  for (let i = 1; i < points.length; i++) d += lineTo(points[i]!)
  return closed ? `${d}Z` : d
}

/** Axis-aligned staircase: hold each value until halfway along the independent
 *  axis, then step. */
export function stepPath(points: readonly Point[], axis: CurveAxis = 'x'): string {
  if (points.length === 0) return ''
  let d = moveTo(points[0]!)
  for (let i = 1; i < points.length; i++) {
    const [t0, w0] = split(points[i - 1]!, axis)
    const [t1, w1] = split(points[i]!, axis)
    const mid = (t0 + t1) / 2
    d += lineTo(join(mid, w0, axis)) + lineTo(join(mid, w1, axis)) + lineTo(points[i]!)
  }
  return d
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Its defining property is that
 * the curve NEVER OVERSHOOTS the data: between two samples it stays within
 * their values, so a series that only rises cannot dip below a point on the way.
 * A plain Catmull-Rom or cardinal spline does overshoot, and on a chart that
 * means drawing a number nobody measured.
 *
 * Defined on a function y = f(x) with strictly increasing x. It is therefore
 * meaningless on a closed angular loop, which is why `polarProjection` declines
 * it — see `projection.ts`.
 */
export function monotonePath(points: readonly Point[], axis: CurveAxis = 'x'): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return moveTo(points[0]!)
  if (n === 2) return linearPath(points)

  // Everything below works in (t, w) — independent, dependent — so the same
  // arithmetic serves a vertical and a horizontal chart.
  const tw = points.map((p) => split(p, axis))
  // Secant slopes between consecutive points.
  const dt: number[] = []
  const secant: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = tw[i + 1]![0] - tw[i]![0]
    const d = tw[i + 1]![1] - tw[i]![1]
    dt.push(h)
    secant.push(h === 0 ? 0 : d / h)
  }

  // Tangents: one-sided at the ends, weighted harmonic mean inside. A sign
  // change (or a flat segment) forces a ZERO tangent — that is the clamp that
  // makes the result monotone, and dropping it is how an overshooting "monotone"
  // curve gets shipped.
  const tangent: number[] = new Array(n).fill(0)
  tangent[0] = secant[0]!
  tangent[n - 1] = secant[n - 2]!
  for (let i = 1; i < n - 1; i++) {
    const a = secant[i - 1]!
    const b = secant[i]!
    if (a * b <= 0) {
      tangent[i] = 0
      continue
    }
    const h0 = dt[i - 1]!
    const h1 = dt[i]!
    const w0 = 2 * h1 + h0
    const w1 = h1 + 2 * h0
    tangent[i] = (w0 + w1) / (w0 / a + w1 / b)
  }

  let d = moveTo(points[0]!)
  for (let i = 0; i < n - 1; i++) {
    const [t0, w0] = tw[i]!
    const [t1, w1] = tw[i + 1]!
    const h = dt[i]!
    const c1 = join(t0 + h / 3, w0 + (tangent[i]! * h) / 3, axis)
    const c2 = join(t1 - h / 3, w1 - (tangent[i + 1]! * h) / 3, axis)
    const end = points[i + 1]!
    d += `C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(end.x)},${fmt(end.y)}`
  }
  return d
}

/** Join a run of points with the named curve. `closed` applies to `linear`
 *  only — the other two are defined on an open, x-increasing run. */
export function curvePath(
  points: readonly Point[],
  curve: Curve,
  closed = false,
  axis: CurveAxis = 'x',
): string {
  switch (curve) {
    case 'monotone':
      return monotonePath(points, axis)
    case 'step':
      return stepPath(points, axis)
    case 'linear':
      return linearPath(points, closed)
  }
}

/**
 * A filled region between an upper run and a lower run. The lower run is walked
 * BACKWARDS and appended, then the path is closed — one subpath, so a fill-rule
 * cannot punch a hole in it the way two separate subpaths can.
 */
export function areaPath(
  upper: readonly Point[],
  lower: readonly Point[],
  curve: Curve,
  axis: CurveAxis = 'x',
): string {
  if (upper.length === 0) return ''
  const top = curvePath(upper, curve, false, axis)
  const reversed = [...lower].reverse()
  if (reversed.length === 0) return `${top}Z`
  // The join between the two runs is a straight line by construction: the
  // curve's own tangents describe each run, not the seam between them.
  const bottom = curvePath(reversed, curve, false, axis).replace(/^M/, 'L')
  return `${top}${bottom}Z`
}

/** An axis-aligned rectangle, corners in any order. */
export function rectPath(x0: number, y0: number, x1: number, y1: number): string {
  const left = Math.min(x0, x1)
  const right = Math.max(x0, x1)
  const top = Math.min(y0, y1)
  const bottom = Math.max(y0, y1)
  return (
    `M${fmt(left)},${fmt(top)}` +
    `L${fmt(right)},${fmt(top)}` +
    `L${fmt(right)},${fmt(bottom)}` +
    `L${fmt(left)},${fmt(bottom)}Z`
  )
}

/** A full circle, as two arcs — one arc of 360° is degenerate and draws
 *  nothing, which is the classic way a polar gridline disappears. */
export function circlePath(cx: number, cy: number, r: number): string {
  const radius = Math.abs(r)
  if (radius === 0) return ''
  return (
    `M${fmt(cx - radius)},${fmt(cy)}` +
    `A${fmt(radius)},${fmt(radius)} 0 1 0 ${fmt(cx + radius)},${fmt(cy)}` +
    `A${fmt(radius)},${fmt(radius)} 0 1 0 ${fmt(cx - radius)},${fmt(cy)}Z`
  )
}

/** A point on a circle. Angles are RADIANS CLOCKWISE FROM 12 O'CLOCK, which is
 *  where every reader expects a chart to start; SVG's own 0 is 3 o'clock. */
export function polarPoint(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) }
}

/**
 * An annular sector — the polar answer to a bar. `r0` is the inner radius (0
 * gives a pie wedge, > 0 a donut segment); angles follow {@link polarPoint}.
 *
 * A sweep of a full turn or more is drawn as a complete ring, because the arc
 * endpoints would otherwise coincide and SVG would draw nothing at all.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const inner = Math.min(Math.abs(r0), Math.abs(r1))
  const outer = Math.max(Math.abs(r0), Math.abs(r1))
  if (outer === 0) return ''
  const start = Math.min(a0, a1)
  const end = Math.max(a0, a1)
  const sweep = end - start
  if (sweep <= 0) return ''
  if (sweep >= Math.PI * 2) {
    const ring = circlePath(cx, cy, outer)
    return inner > 0 ? `${ring}${circlePath(cx, cy, inner)}` : ring
  }
  const large = sweep > Math.PI ? 1 : 0
  const o0 = polarPoint(cx, cy, outer, start)
  const o1 = polarPoint(cx, cy, outer, end)
  const i1 = polarPoint(cx, cy, inner, end)
  const i0 = polarPoint(cx, cy, inner, start)
  // Outer arc runs clockwise (sweep-flag 1), inner arc back anticlockwise (0).
  let d = `M${fmt(o0.x)},${fmt(o0.y)}A${fmt(outer)},${fmt(outer)} 0 ${large} 1 ${fmt(o1.x)},${fmt(o1.y)}`
  if (inner > 0) {
    d += `L${fmt(i1.x)},${fmt(i1.y)}A${fmt(inner)},${fmt(inner)} 0 ${large} 0 ${fmt(i0.x)},${fmt(i0.y)}Z`
  } else {
    d += `L${fmt(cx)},${fmt(cy)}Z`
  }
  return d
}
