/**
 * Numeric grid — the ONE clamp/snap/step implementation every mutation path in
 * the package routes through (`setValue`, `commit`, `increment`/`decrement`,
 * `setThumb`, pointer drag).
 *
 * Each component used to carry its own copy and they drifted in three separate
 * directions (#125): a `decimalPlaces` that scanned for '.' reported ZERO
 * decimals for an exponential step ('1e-7'), so every snap through
 * `toFixed(0)` collapsed to 0; `increment` added a step without re-snapping, so
 * an off-grid value stayed off-grid forever; and `slider.setValue` skipped
 * clamping altogether while `setThumb` twelve lines below clamped.
 */

/**
 * A stepped numeric range. `min`/`max` default to unbounded and `step` to 0
 * (= continuous). Component states name their fields the same way, so a state
 * object can be passed straight in.
 */
export interface NumericGrid {
  min?: number
  max?: number
  step?: number
}

/**
 * Slack for the float division `(value - origin) / step`: 10/0.1 is not exactly
 * 100 in IEEE-754, and without it the last grid value below `max` is dropped.
 */
const STEP_EPSILON = 1e-9

/** `toFixed` accepts at most 100 fraction digits. */
const MAX_FIXED_DIGITS = 100

export function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * Fraction digits `n` is written with, INCLUDING exponential notation —
 * `String(1e-7)` is '1e-7', which a scan for '.' reads as zero decimals.
 */
export function decimalPlaces(n: number): number {
  if (!isFinite(n)) return 0
  const str = String(Math.abs(n))
  const e = str.indexOf('e')
  if (e === -1) {
    const dot = str.indexOf('.')
    return dot === -1 ? 0 : str.length - dot - 1
  }
  const mantissa = str.slice(0, e)
  const exponent = Number(str.slice(e + 1))
  const dot = mantissa.indexOf('.')
  const fraction = dot === -1 ? 0 : mantissa.length - dot - 1
  return Math.max(0, fraction - exponent)
}

/** Round away the drift that `origin + k * step` accumulates. */
function roundTo(n: number, decimals: number): number {
  if (!isFinite(n)) return n
  return Number(n.toFixed(Math.min(Math.max(decimals, 0), MAX_FIXED_DIGITS)))
}

/** Digits a value on the `origin + k * step` grid can need. */
function gridDecimals(step: number, origin: number): number {
  return Math.max(decimalPlaces(step), decimalPlaces(origin))
}

/**
 * The grid anchor: `min` when it is finite, else 0. One rule for every caller —
 * a per-component anchor is how `setValue` and `increment` came to disagree
 * about which values are legal.
 */
function gridOrigin(grid: NumericGrid): number {
  const min = grid.min ?? -Infinity
  return isFinite(min) ? min : 0
}

/** Nearest multiple of `step` from `origin`. A non-positive step is a no-op. */
export function snapToStep(value: number, step: number, origin = 0): number {
  if (!(step > 0) || !isFinite(step)) return value
  const base = isFinite(origin) ? origin : 0
  return roundTo(base + Math.round((value - base) / step) * step, gridDecimals(step, base))
}

/**
 * Clamp into the range AND snap onto the grid. The result is always within
 * `[min, max]`: snapping can leave the range when an endpoint is not itself on
 * the grid (min 0, max 10, step 4 → 10 snaps up to 12), and the answer there is
 * the last grid value INSIDE the range, not an out-of-range or off-grid one.
 */
export function clampToStep(value: number, grid: NumericGrid): number {
  const min = grid.min ?? -Infinity
  const max = grid.max ?? Infinity
  const step = grid.step ?? 0
  if (!(step > 0) || !isFinite(step)) return clamp(value, min, max)
  const base = gridOrigin(grid)
  const decimals = gridDecimals(step, base)
  let snapped = snapToStep(clamp(value, min, max), step, base)
  if (snapped > max) {
    snapped = roundTo(base + Math.floor((max - base) / step + STEP_EPSILON) * step, decimals)
  }
  if (snapped < min) {
    snapped = roundTo(base + Math.ceil((min - base) / step - STEP_EPSILON) * step, decimals)
  }
  // A range narrower than one step holds no grid value at all; the bound wins.
  return clamp(snapped, min, max)
}

/**
 * Move `count` whole steps (negative to step down), then clamp+snap.
 *
 * From an OFF-GRID value one call moves to the nearest grid value in the
 * direction of travel and stops there — that jump is the whole change, however
 * large `count` is. This is HTML's `stepUp`/`stepDown` (step 3 of the
 * value-stepping algorithm) and it is what makes `increment` land on the grid
 * instead of dragging an off-grid value along forever.
 */
export function stepBy(value: number, count: number, grid: NumericGrid): number {
  const step = grid.step ?? 0
  if (!(step > 0) || !isFinite(step) || count === 0) return clampToStep(value, grid)
  const base = gridOrigin(grid)
  const decimals = gridDecimals(step, base)
  const offset = (value - base) / step
  const nearest = Math.round(offset)
  const onGrid = Math.abs(offset - nearest) <= STEP_EPSILON
  const steps = onGrid
    ? nearest + count
    : count > 0
      ? Math.ceil(offset - STEP_EPSILON)
      : Math.floor(offset + STEP_EPSILON)
  return clampToStep(roundTo(base + steps * step, decimals), grid)
}
