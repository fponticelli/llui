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

// ── Share scale ───────────────────────────────────────────────────────────

/** One slice of a proportionally-allocated independent axis. */
export interface ShareSlice {
  /** Start of the slice in normalized u. */
  start: number
  /** End of the slice in normalized u. */
  end: number
  /** The slice's fraction of the whole — `end - start`, named for readability. */
  share: number
}

/**
 * Allocate the independent axis [0, 1] in PROPORTION to each value, instead of
 * giving every category an equal slot the way {@link bandExtent} does.
 *
 * This is the whole of what a pie chart is. Under a polar projection each slice
 * is a wedge whose angle states its share; under a cartesian one the same
 * slices are the segments of a single full-width 100%-share bar. Neither the
 * projection nor any mark needs to know which it is drawing — the magnitude has
 * simply moved from `v` (a bar's height) to `u` (a slice's extent), which is
 * why no new mark type is involved.
 *
 * Three rules, each a correctness statement rather than a default:
 *
 *  - **There is NO padding, and there cannot be.** `bandExtent` takes
 *    `paddingInner`/`paddingOuter` because a bar's slot is arbitrary and the
 *    gaps only cost whitespace. Here the extent IS the datum: gaps would make
 *    the slices sum to less than the whole, so every slice would overstate or
 *    understate its share by however much padding was chosen, and a full turn
 *    would no longer be 100%. Separate slices with a stroke in the skin (what
 *    shadcn's own pie does), never with a gap in the scale.
 *  - **A NEGATIVE value takes no arc.** A share of a negative quantity is not
 *    defined, and the two silent readings are both wrong: using the magnitude
 *    draws a slice for a number nobody measured, and letting it subtract makes
 *    the remaining slices sum past 1. Contributing zero is the only reading
 *    that neither invents data nor breaks the total. Same argument as
 *    `polarProjection` declining `monotone` rather than approximating it.
 *  - **A total of zero yields zero-width slices**, not `NaN`. No data is a
 *    normal state; a `NaN` in a `u` becomes a `NaN` in a path string, and one
 *    of those voids the whole path element.
 *
 * The final slice is closed at exactly 1 rather than at the accumulated sum, so
 * float drift cannot leave a hairline wedge of background at the end of the
 * axis — visible on a full-turn pie as a seam at 12 o'clock.
 */
export function shareExtents(values: readonly number[]): ShareSlice[] {
  const weights = values.map((n) => (isFinite(n) && n > 0 ? n : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  const out: ShareSlice[] = []
  if (!(total > 0)) {
    for (let i = 0; i < weights.length; i++) out.push({ start: 0, end: 0, share: 0 })
    return out
  }
  let cursor = 0
  for (let i = 0; i < weights.length; i++) {
    const start = cursor
    const end = i === weights.length - 1 ? 1 : cursor + weights[i]! / total
    out.push({ start, end, share: end - start })
    cursor = end
  }
  return out
}

/**
 * The slice containing a normalized position — the hit test behind hover on a
 * pie.
 *
 * CONTAINMENT, not the nearest centre that {@link nearestBand} uses. Bands have
 * gaps, so a pointer between two bars has to be given to one of them; slices
 * tile the axis with no gaps, so containment is exact and nearest-centre would
 * be actively wrong — a thin slice beside a wide one would lose its own
 * interior to the wide one's centre.
 *
 * Zero-width slices are unhittable by construction. `u` outside [0, 1] and an
 * axis with no positive total both answer `null`.
 */
export function nearestShare(u: number, slices: readonly ShareSlice[]): number | null {
  if (!isFinite(u)) return null
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]!
    if (s.share > 0 && u >= s.start && u < s.end) return i
  }
  // The closing edge belongs to the last slice with any width, so a pointer
  // exactly at u === 1 lands somewhere rather than nowhere.
  if (u === 1) {
    for (let i = slices.length - 1; i >= 0; i--) {
      if (slices[i]!.share > 0) return i
    }
  }
  return null
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
