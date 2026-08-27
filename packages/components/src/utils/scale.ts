/**
 * Scales — the DATA half of a chart, with no pixels and no DOM in sight.
 *
 * Everything here maps a value into NORMALIZED space: `u` ∈ [0, 1] along the
 * independent axis (categories, or a continuous x), `v` ∈ [0, 1] along the
 * dependent axis (magnitude). Turning (u, v) into a pixel is the projection's
 * job — see `projection.ts` — and keeping that boundary is the whole reason a
 * cartesian chart and a polar one can share every mark, gridline and tick.
 *
 * Hand-rolled rather than pulled from `d3-scale`: `@llui/components` has one
 * runtime dependency (`@standard-schema/spec`, types only) and the subset a
 * chart needs is this file. The nice-number algorithm below IS d3's, ported —
 * it is a published, well-specified rule, and inventing a different one would
 * make every axis in the package disagree with every chart anyone has seen.
 */

import { finiteBound } from './number.js'

/** A normalized sample: position along the independent axis, and magnitude. */
export interface Sample {
  u: number
  v: number
}

/** A closed numeric interval. Both ends are finite by construction. */
export interface Domain {
  min: number
  max: number
}

/**
 * Map a value into [0, 1] across `domain`. A DEGENERATE domain (min === max)
 * maps everything to 0.5 rather than dividing by zero — a single-valued series
 * draws as a flat line through the middle, which is the only reading that is
 * not a crash or a NaN in a path string.
 */
export function normalize(value: number, domain: Domain): number {
  const span = domain.max - domain.min
  if (!isFinite(value)) return 0
  if (span === 0) return 0.5
  return (value - domain.min) / span
}

/** Inverse of {@link normalize}. */
export function denormalize(u: number, domain: Domain): number {
  return domain.min + u * (domain.max - domain.min)
}

// ── Nice numbers (ported from d3-array) ───────────────────────────────────

const E10 = Math.sqrt(50)
const E5 = Math.sqrt(10)
const E2 = Math.sqrt(2)

/**
 * The step size a nice axis would use to fit about `count` ticks into
 * `[start, stop]`. A negative return means "one tick every 1/-step units" —
 * d3's encoding, kept because the reciprocal form avoids the float drift that
 * `10 ** -power` introduces for small steps.
 */
export function tickIncrement(start: number, stop: number, count: number): number {
  const step = (stop - start) / Math.max(0, count)
  const power = Math.floor(Math.log10(step))
  const error = step / 10 ** power
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1
  return power >= 0 ? factor * 10 ** power : -(10 ** -power) / factor
}

/**
 * Round, human-readable tick values covering `[start, stop]`. Returns an EMPTY
 * array for a non-finite or degenerate range rather than looping forever —
 * a chart with no data is a normal state, not an error.
 */
export function ticks(start: number, stop: number, count: number): number[] {
  if (!isFinite(start) || !isFinite(stop) || !(count > 0)) return []
  if (start === stop) return [start]
  const reverse = stop < start
  const lo = reverse ? stop : start
  const hi = reverse ? start : stop
  const step = tickIncrement(lo, hi, count)
  if (!isFinite(step) || step === 0) return []
  const out: number[] = []
  if (step > 0) {
    const last = Math.floor(hi / step)
    for (let i = Math.ceil(lo / step); i <= last; i++) out.push(i * step)
  } else {
    const inv = -step
    const last = Math.floor(hi * inv)
    for (let i = Math.ceil(lo * inv); i <= last; i++) out.push(i / inv)
  }
  return reverse ? out.reverse() : out
}

/**
 * Extend `[min, max]` outward to the nearest round tick boundaries, so the axis
 * ends on a labelled value instead of mid-air. Iterates because widening the
 * domain can change the chosen step, which can change the boundaries again;
 * d3's `nice` does the same, and it converges in at most a few rounds.
 */
export function niceDomain(min: number, max: number, count: number): Domain {
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 }
  if (min === max) {
    return min === 0 ? { min: 0, max: 1 } : { min: Math.min(0, min), max: Math.max(0, min) }
  }
  let lo = Math.min(min, max)
  let hi = Math.max(min, max)
  for (let round = 0; round < 10; round++) {
    const step = tickIncrement(lo, hi, count)
    if (!isFinite(step) || step === 0) break
    let nextLo: number
    let nextHi: number
    if (step > 0) {
      nextLo = Math.floor(lo / step) * step
      nextHi = Math.ceil(hi / step) * step
    } else {
      const inv = -step
      nextLo = Math.ceil(lo * inv) / inv
      nextHi = Math.floor(hi * inv) / inv
    }
    if (nextLo === lo && nextHi === hi) break
    lo = nextLo
    hi = nextHi
  }
  return { min: lo, max: hi }
}

/**
 * The value-axis domain for a set of series.
 *
 * `min` / `max` are UNBOUNDED-CAPABLE bounds in the sense of `finiteBound`
 * (#177): an absent one means "derive it", never `±Infinity`. A derived domain
 * always INCLUDES ZERO, because a bar whose baseline is not zero misrepresents
 * its own length — the one axis default worth being opinionated about. A caller
 * who wants otherwise passes both bounds.
 */
export function valueDomain(
  values: readonly number[],
  opts: { min?: number; max?: number; tickCount: number },
): Domain {
  const lo = finiteBound(opts.min)
  const hi = finiteBound(opts.max)
  if (lo !== undefined && hi !== undefined) {
    return lo === hi ? { min: lo, max: lo + 1 } : { min: Math.min(lo, hi), max: Math.max(lo, hi) }
  }
  const finite = values.filter((n) => isFinite(n))
  const dataMin = finite.length > 0 ? Math.min(...finite, 0) : 0
  const dataMax = finite.length > 0 ? Math.max(...finite, 0) : 1
  const nice = niceDomain(lo ?? dataMin, hi ?? dataMax, opts.tickCount)
  return { min: lo ?? nice.min, max: hi ?? nice.max }
}

// ── Band scale ────────────────────────────────────────────────────────────

/** A discrete axis of `count` slots laid out across [0, 1]. */
export interface Band {
  count: number
  /** Gap between adjacent bands, as a fraction of a slot. */
  paddingInner: number
  /** Gap before the first and after the last band, as a fraction of a slot. */
  paddingOuter: number
}

/** The [start, end] extent of band `i` in normalized u. */
export function bandExtent(i: number, band: Band): [number, number] {
  const { count, paddingInner, paddingOuter } = band
  if (!(count > 0)) return [0, 0]
  // Total width = count slots + (count - 1) inner gaps + 2 outer gaps, in slots.
  const slots = count + (count - 1) * paddingInner + 2 * paddingOuter
  const slot = 1 / slots
  const start = (paddingOuter + i * (1 + paddingInner)) * slot
  return [start, start + slot]
}

/** The centre of band `i` in normalized u. */
export function bandCenter(i: number, band: Band): number {
  const [a, b] = bandExtent(i, band)
  return (a + b) / 2
}

/**
 * The band index nearest a normalized position — the hit test behind hover and
 * pointer tracking. Returns `null` for an empty axis.
 *
 * Nearest-CENTRE, not containment: the gaps between bands belong to whichever
 * band is closer, so a pointer never falls into a dead zone between two bars.
 */
export function nearestBand(u: number, band: Band): number | null {
  if (!(band.count > 0) || !isFinite(u)) return null
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < band.count; i++) {
    const d = Math.abs(u - bandCenter(i, band))
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}
