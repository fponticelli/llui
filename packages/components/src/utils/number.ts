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
 *
 * Being the one implementation is also why the NON-FINITE policy lives here and
 * nowhere else (#152): `clamp` maps a `NaN`/`±Infinity` input to a defined legal
 * value, so every component inherits a finite, in-range, on-grid result from
 * every mutation path — including `init`, which a per-reducer guard would miss.
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

/**
 * A finite value inside `[min, max]` for an input that names no position on it.
 * `min` when it is finite (the range's own origin, matching `gridOrigin`), else
 * 0 when the range holds it, else the finite bound that is left.
 */
function finiteInRange(min: number, max: number): number {
  const candidate = 0 < min ? min : 0 > max ? max : 0
  return isFinite(candidate) ? candidate : 0
}

/**
 * Where a NON-FINITE input lands. `±Infinity` keeps the answer the comparisons
 * already gave it whenever the bound it points at is finite — `clamp(Infinity,
 * 0, 50)` is still 50, which is what `angle-slider`'s Home/End rely on — so
 * this only decides the cases where that bound is itself infinite. `NaN` has no
 * direction at all, so it takes the range's origin.
 */
function nonFiniteFallback(n: number, min: number, max: number): number {
  if (n === Infinity && isFinite(max)) return max
  if (n === -Infinity && isFinite(min)) return min
  return finiteInRange(min, max)
}

/**
 * Bound `n` into `[min, max]`. The result is always FINITE: a non-finite input
 * maps to a defined legal value instead of being stored verbatim.
 *
 * Every comparison against `NaN` is false, so `NaN` used to fall straight
 * through to `return n` and land in state — package-wide, since this is the one
 * clamp every mutation path routes through (#152). It is not merely a wrong
 * number: `JSON.stringify(NaN)` (and `Infinity`) is `null`, so a non-finite
 * value breaks the State-is-JSON-serializable invariant and with it devtools
 * time-travel, `@llui/test` replay, agent state snapshots and SSR rehydration.
 * Rejecting at this boundary is what lets every caller state its own
 * postcondition — e.g. `slider`'s `withThumb` — without a finiteness caveat.
 */
export function clamp(n: number, min: number, max: number): number {
  if (!isFinite(n)) return nonFiniteFallback(n, min, max)
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

/**
 * Nearest multiple of `step` from `origin`. A non-positive step is a no-op.
 *
 * A non-finite `value` names no position on the grid, so it snaps to the grid's
 * own anchor — the same policy `clamp` applies to the range (#152). This is
 * unreachable from `clampToStep`, which clamps first; it keeps the util's
 * direct consumers on the same rule.
 */
export function snapToStep(value: number, step: number, origin = 0): number {
  const base = isFinite(origin) ? origin : 0
  if (!isFinite(value)) return base
  if (!(step > 0) || !isFinite(step)) return value
  return roundTo(base + Math.round((value - base) / step) * step, gridDecimals(step, base))
}

/**
 * Clamp into the range AND snap onto the grid. The result is always within
 * `[min, max]`: snapping can leave the range when an endpoint is not itself on
 * the grid (min 0, max 10, step 4 → 10 snaps up to 12), and the answer there is
 * the last grid value INSIDE the range, not an out-of-range or off-grid one.
 * It is always FINITE too — the clamp rejects a non-finite input first (#152).
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
 *
 * ONE DELIBERATE DIVERGENCE from the spec: HTML's step base falls back min ->
 * the `value` CONTENT ATTRIBUTE -> 0; `gridOrigin` goes min -> 0. A headless
 * machine has no content attributes — the seed value is just the initial state,
 * and anchoring the grid on it would make two components with the same
 * min/max/step disagree about which values are legal depending on where they
 * happened to start.
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
