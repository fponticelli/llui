/**
 * Calendar ticks — gridlines that land on real period boundaries.
 *
 * `scale.ts`'s {@link ticks} is NUMERIC: it walks a nice step of 1/2/5×10ⁿ from
 * a rounded start. Applied to a timestamp that produces a boundary every
 * 2 000 000 000 ms, which is not the 1st of March, not midnight and not Jan 1 —
 * `Math.round`-ing an epoch never lands on a calendar edge. A time axis needs a
 * different rule, so it gets a different function rather than a special case
 * inside the numeric one.
 *
 * # The ladder
 *
 * `hour → day → week → month → quarter → year`, coarsening until the boundaries
 * fit inside `maxTicks`. `maxTicks` is a MAXIMUM, not a target: the first unit
 * whose boundary count fits is the one chosen, so an 8-day span at `maxTicks: 6`
 * gets two weekly gridlines rather than eight daily ones. Counting is O(1) at
 * every rung (ms arithmetic below `month`, month-index arithmetic above it), so
 * choosing a unit never materialises the boundaries it rejects — a decade-long
 * span does not enumerate 87 600 hours to discover that hours do not fit.
 *
 * Above `year` the ladder runs out of units, so the STRIDE grows instead —
 * every 2nd, 5th, 10th, 25th… year, aligned so the boundaries are decades and
 * centuries rather than an arbitrary phase. Strides apply to `year` ALONE: a
 * 3-year step is a decade-and-a-bit of calendar meaning, whereas a "every 3
 * days" step is just a numeric step wearing a calendar's clothes, and if that
 * is what a caller wants they should use `ticks` on the raw milliseconds.
 *
 * # Timezones — READ THIS BEFORE CHANGING ANYTHING HERE
 *
 * Boundaries are computed against a FIXED OFFSET from UTC (`offsetMinutes`,
 * default 0 = UTC), never against an IANA zone and never against the ambient
 * zone. Two reasons, both hard constraints rather than preferences:
 *
 *  - **Chart geometry must be SSR-identical.** Reading the ambient zone makes
 *    the output a function of where the code runs, so a server render and a
 *    client render of the same data disagree and the first commit rewrites
 *    every gridline. A number passed in by the caller is the same on both
 *    sides by construction.
 *  - **A fixed offset cannot straddle a DST transition.** Under a fixed offset
 *    a day is EXACTLY 86 400 000 ms, which is what makes the O(1) counting
 *    above sound. An IANA zone's "day" is 23 or 25 hours twice a year, so the
 *    same arithmetic would drift a boundary by an hour and, at the ladder's
 *    week rung, put a "Monday" gridline on a Sunday.
 *
 * The accepted cost, stated plainly: for a reader in a DST zone, boundaries
 * computed from that zone's standard offset sit an hour off their wall clock
 * for half the year. On a cell-sized sparkline whose finest rung is an hour
 * that is at most one tick's width, and at the day rung and coarser it is
 * invisible. What this does NOT do is silently follow the ambient zone and
 * produce a different picture on the server than in the browser. A caller who
 * genuinely needs zone-correct boundaries must resolve the offset for the span
 * they are drawing and pass it; there is deliberately no `zone: string` knob,
 * because honouring one correctly means a per-boundary offset lookup and that
 * is a different function with a different cost profile.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 604_800_000
const MINUTE_MS = 60_000

/**
 * A hard ceiling on the boundaries one call will produce. Reached only by
 * FORCING a fine unit across an enormous span; the automatic ladder can never
 * exceed `maxTicks`. Over the ceiling the answer is an EMPTY array — no
 * gridlines — rather than a truncated one, because a truncated axis silently
 * claims the data ends where the array does.
 */
export const MAX_CALENDAR_TICKS = 2000

/** Rungs of the ladder, finest first. */
export type CalendarUnit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'

const LADDER: readonly CalendarUnit[] = ['hour', 'day', 'week', 'month', 'quarter', 'year']

/** Months spanned by one unit, for the three calendar-arithmetic rungs. */
const MONTHS_PER: Partial<Record<CalendarUnit, number>> = { month: 1, quarter: 3, year: 12 }

export interface CalendarOptions {
  /**
   * Minutes east of UTC that boundaries are measured in. Default 0 (UTC). A
   * FIXED offset — see the module note; `-300` is US Eastern standard time and
   * stays at −5 across a DST transition rather than following it.
   */
  offsetMinutes?: number
  /** First day of the week for the `week` rung: 0 = Sunday … 6 = Saturday.
   *  Default 1 (Monday), matching ISO 8601. */
  weekStartsOn?: number
}

export interface CalendarStepOptions extends CalendarOptions {
  /** Upper bound on the number of boundaries. Default 6. */
  maxTicks?: number
  /** Force a rung instead of choosing one from the span. */
  unit?: CalendarUnit
}

/** A chosen rung, plus how many of it each boundary advances. `stride` is
 *  always 1 except on `year`. */
export interface CalendarStep {
  unit: CalendarUnit
  stride: number
}

export interface CalendarTick {
  /** The boundary instant, in epoch milliseconds. */
  at: number
  unit: CalendarUnit
}

// ── Fixed-offset calendar arithmetic ──────────────────────────────────────

function offsetOf(opts: CalendarOptions): number {
  const raw = opts.offsetMinutes
  return typeof raw === 'number' && isFinite(raw) ? raw : 0
}

function weekStartOf(opts: CalendarOptions): number {
  const raw = opts.weekStartsOn
  if (typeof raw !== 'number' || !isFinite(raw)) return 1
  // A non-integer or out-of-range value would silently rotate the week; wrap it
  // into 0..6 so the only reachable behaviour is a real weekday.
  return ((Math.trunc(raw) % 7) + 7) % 7
}

/**
 * `Date.UTC` maps years 0–99 onto 1900–1999 — a documented legacy rule that
 * would put a year-0042 boundary in 1942. Every construction here goes through
 * this instead.
 */
function utcAt(year: number, month: number, day: number): number {
  const t = Date.UTC(year, month, day)
  if (year >= 0 && year <= 99) {
    const d = new Date(t)
    d.setUTCFullYear(year)
    return d.getTime()
  }
  return t
}

/** Floor an instant to the start of its `unit`, in the offset's calendar. */
export function floorToUnit(at: number, unit: CalendarUnit, opts: CalendarOptions = {}): number {
  if (!isFinite(at)) return NaN
  const off = offsetOf(opts) * MINUTE_MS
  const s = at + off
  let floored: number
  switch (unit) {
    case 'hour':
      floored = Math.floor(s / HOUR_MS) * HOUR_MS
      break
    case 'day':
      floored = Math.floor(s / DAY_MS) * DAY_MS
      break
    case 'week': {
      // Floor to the day first: the week's phase is a whole number of days from
      // the epoch's own weekday, and mixing the two in one division loses it.
      const day = Math.floor(s / DAY_MS) * DAY_MS
      const dow = new Date(day).getUTCDay()
      const back = (((dow - weekStartOf(opts)) % 7) + 7) % 7
      floored = day - back * DAY_MS
      break
    }
    case 'month': {
      const d = new Date(s)
      floored = utcAt(d.getUTCFullYear(), d.getUTCMonth(), 1)
      break
    }
    case 'quarter': {
      const d = new Date(s)
      floored = utcAt(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)
      break
    }
    case 'year': {
      const d = new Date(s)
      floored = utcAt(d.getUTCFullYear(), 0, 1)
      break
    }
  }
  return floored - off
}

/** Advance an instant by `n` whole units, in the offset's calendar. */
export function addUnits(
  at: number,
  unit: CalendarUnit,
  n: number,
  opts: CalendarOptions = {},
): number {
  if (!isFinite(at) || !isFinite(n)) return NaN
  switch (unit) {
    case 'hour':
      return at + n * HOUR_MS
    case 'day':
      return at + n * DAY_MS
    case 'week':
      return at + n * WEEK_MS
    case 'month':
    case 'quarter':
    case 'year': {
      // Calendar arithmetic: months are not a fixed number of milliseconds, so
      // the only correct step is on the (year, month) pair. Every boundary this
      // is applied to is already the 1st, so no day-of-month clamping arises.
      const off = offsetOf(opts) * MINUTE_MS
      const d = new Date(at + off)
      const months = n * MONTHS_PER[unit]!
      const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months
      const year = Math.floor(total / 12)
      const month = ((total % 12) + 12) % 12
      return utcAt(year, month, 1) - off
    }
  }
}

/** Month index (year × 12 + month) of an instant's own month, in the offset's
 *  calendar. The unit of the O(1) count above the `week` rung. */
function monthIndex(at: number, opts: CalendarOptions): number {
  const d = new Date(at + offsetOf(opts) * MINUTE_MS)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/** Floor to a strided step. Identical to {@link floorToUnit} except on a
 *  strided `year`, where the year itself is aligned to a multiple of the
 *  stride so boundaries are decades and centuries, not an arbitrary phase. */
function stepFloor(at: number, step: CalendarStep, opts: CalendarOptions): number {
  if (step.unit !== 'year' || step.stride <= 1) return floorToUnit(at, step.unit, opts)
  const off = offsetOf(opts) * MINUTE_MS
  const year = new Date(at + off).getUTCFullYear()
  return utcAt(Math.floor(year / step.stride) * step.stride, 0, 1) - off
}

function stepCeil(at: number, step: CalendarStep, opts: CalendarOptions): number {
  const floored = stepFloor(at, step, opts)
  return floored === at ? at : addUnits(floored, step.unit, step.stride, opts)
}

// ── Counting, choosing, generating ────────────────────────────────────────

/**
 * How many boundaries of `step` fall inside `[start, end]` — WITHOUT building
 * them. Constant time at every rung, which is what lets the ladder reject a
 * finer unit for a century-long span for free.
 *
 * One informational edge, in the safe direction: within a month of the extremes
 * of the representable range (year ±271821), flooring to a period start falls
 * outside what a `Date` can hold and {@link utcAt} answers `NaN`, so the count
 * is 0 and {@link calendarTicks} draws no gridlines. It neither hangs nor
 * throws; the axis is simply unlabelled at the end of time.
 */
export function countCalendarTicks(
  start: number,
  end: number,
  step: CalendarStep,
  opts: CalendarOptions = {},
): number {
  if (!isFinite(start) || !isFinite(end) || end < start) return 0
  if (!(step.stride >= 1)) return 0
  const first = stepCeil(start, step, opts)
  if (!isFinite(first) || first > end) return 0
  const months = MONTHS_PER[step.unit]
  if (months === undefined) {
    const ms =
      (step.unit === 'hour' ? HOUR_MS : step.unit === 'day' ? DAY_MS : WEEK_MS) * step.stride
    return Math.floor((end - first) / ms) + 1
  }
  // Boundaries sit at month indices `first + k · months · stride`, and a
  // boundary is inside the range exactly when its month index is at or before
  // the month CONTAINING `end` — the 1st of that month is never after `end`.
  const span = monthIndex(end, opts) - monthIndex(first, opts)
  if (span < 0) return 0
  return Math.floor(span / (months * step.stride)) + 1
}

/** Strides tried on the `year` rung: 1, 2, 5, 10, 20, 50, 100 … A 1/2/5 ladder
 *  is the same progression `tickIncrement` uses for numbers, so a century axis
 *  and a numeric one coarsen the same way. */
function* yearStrides(): Generator<number> {
  for (let power = 0; power <= 9; power++) {
    for (const factor of [1, 2, 5]) yield factor * 10 ** power
  }
}

/**
 * The finest rung whose boundaries fit inside `maxTicks`.
 *
 * A FORCED `unit` is honoured as given (stride 1), except on `year`, where the
 * stride still grows to fit — "yearly" over four centuries has to mean
 * something, and 400 gridlines is not it.
 */
export function chooseCalendarStep(
  start: number,
  end: number,
  opts: CalendarStepOptions = {},
): CalendarStep {
  const max =
    typeof opts.maxTicks === 'number' && opts.maxTicks >= 1 ? Math.floor(opts.maxTicks) : 6
  const forced = opts.unit
  if (forced !== undefined && forced !== 'year') return { unit: forced, stride: 1 }
  if (forced === undefined) {
    for (const unit of LADDER) {
      if (unit === 'year') break
      if (countCalendarTicks(start, end, { unit, stride: 1 }, opts) <= max)
        return { unit, stride: 1 }
    }
  }
  for (const stride of yearStrides()) {
    if (countCalendarTicks(start, end, { unit: 'year', stride }, opts) <= max) {
      return { unit: 'year', stride }
    }
  }
  return { unit: 'year', stride: 10 ** 9 }
}

/**
 * Calendar boundaries inside `[start, end]`, ascending.
 *
 * An EMPTY array for a non-finite or reversed range, and for a request that
 * would exceed {@link MAX_CALENDAR_TICKS} — a chart with no data is a normal
 * state, and a truncated axis is a lie.
 */
export function calendarTicks(
  start: number,
  end: number,
  opts: CalendarStepOptions = {},
): CalendarTick[] {
  if (!isFinite(start) || !isFinite(end) || end < start) return []
  const step = chooseCalendarStep(start, end, opts)
  const count = countCalendarTicks(start, end, step, opts)
  if (count === 0 || count > MAX_CALENDAR_TICKS) return []
  const out: CalendarTick[] = []
  let at = stepCeil(start, step, opts)
  for (let i = 0; i < count; i++) {
    out.push({ at, unit: step.unit })
    at = addUnits(at, step.unit, step.stride, opts)
  }
  return out
}
