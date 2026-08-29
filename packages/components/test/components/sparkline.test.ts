import { describe, it, expect } from 'vitest'
import { constant, noSend } from '@llui/dom'
import { rootSignal, read } from '../_signal'
import {
  connect,
  geometry,
  init,
  isoDay,
  locateIndex,
  sparklineGeometry,
  sparklineLabel,
  trimLeadingOutliers,
  update,
  type SparklineDot,
  type SparklineGeometryOptions,
  type SparklineMsg,
  type SparklinePoint,
  type SparklineState,
} from '../../src/components/sparkline'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1) // 2026-01-01T00:00:00Z, a Thursday

/** A frame with no padding and no track: user units are the frame's own, so
 *  every position below is stated exactly rather than approximately. */
const BOX: SparklineGeometryOptions = {
  width: 100,
  height: 40,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  track: null,
}

const pts = (values: readonly number[], step = DAY): SparklinePoint[] =>
  values.map((value, i) => ({ at: T0 + i * step, value }))

const geo = (points: readonly SparklinePoint[], over: SparklineGeometryOptions = {}) =>
  sparklineGeometry(points, { ...BOX, ...over })

const state = (over: Partial<SparklineState> = {}): SparklineState => ({
  ...init({
    points: pts([0, 50, 100]),
    width: 100,
    height: 40,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    track: null,
    min: 0,
    max: 100,
  }),
  ...over,
})

const step = (s: SparklineState, ...msgs: SparklineMsg[]): SparklineState =>
  msgs.reduce((acc, m) => update(acc, m)[0], s)

// ── The pure function ─────────────────────────────────────────────────────

describe('sparkline — sparklineGeometry is a pure function needing no signal', () => {
  it('maps time to u and value to v with no projection surprises', () => {
    const g = geo(pts([0, 50, 100]), { min: 0, max: 100 })
    expect(g.path).toBe('M0,40L50,20L100,0')
    expect(g.dots.map((d) => [d.x, d.y])).toEqual([
      [0, 40],
      [50, 20],
      [100, 0],
    ])
  })

  it('draws nothing, and says so, for no points at all', () => {
    const g = geo([])
    expect(g.path).toBe('')
    expect(g.dots).toEqual([])
    expect(g.ticks).toEqual([])
    expect(g.band).toBeNull()
    expect(g.summary).toEqual({ count: 0, from: '', to: '', trimmed: 0, stale: false })
    expect(g.label).toBe('No readings')
  })

  it('SORTS its input, so an out-of-order series is not a zigzag', () => {
    const shuffled = [
      { at: T0 + 2 * DAY, value: 100 },
      { at: T0, value: 0 },
      { at: T0 + DAY, value: 50 },
    ]
    expect(geo(shuffled, { min: 0, max: 100 }).path).toBe('M0,40L50,20L100,0')
  })

  it('DROPS a non-finite sample rather than formatting it to 0', () => {
    // One NaN in a path voids the WHOLE path element. Placing the point at 0
    // would instead draw a reading nobody took.
    const g = geo(
      [
        { at: T0, value: 0 },
        { at: T0 + DAY, value: NaN },
        { at: T0 + DAY, value: Infinity },
        { at: NaN, value: 50 },
        { at: T0 + 2 * DAY, value: 100 },
      ],
      { min: 0, max: 100 },
    )
    expect(g.points).toHaveLength(2)
    expect(g.path).toBe('M0,40L100,0')
    expect(g.path).not.toContain('NaN')
  })

  it('a single reading sits mid-frame — a degenerate domain is not a divide by zero', () => {
    // `normalize` answers 0.5 for a zero span, so one reading is a dot in the
    // middle rather than a NaN or a crash. Give it a later `now` and it moves
    // to the left edge, which is the same rule reading a real span.
    const g = geo(pts([42]))
    expect(g.path).toBe('M50,20')
    expect(g.dots).toHaveLength(1)
    expect(g.dots[0]!.last).toBe(true)
    expect(geo(pts([42]), { now: T0 + 4 * DAY }).dots[0]!.x).toBe(0)
  })

  it('honours the curve, and every curve routes through the shared path builders', () => {
    const linear = geo(pts([0, 50, 100]), { min: 0, max: 100, curve: 'linear' })
    const stepped = geo(pts([0, 50, 100]), { min: 0, max: 100, curve: 'step' })
    expect(stepped.path).not.toBe(linear.path)
    expect(stepped.path).toBe('M0,40L25,40L25,20L50,20L75,20L75,0L100,0')
  })
})

// ── Byte-identical output ─────────────────────────────────────────────────

describe('sparkline — path output is BYTE-IDENTICAL for equal input', () => {
  it('two independent computations of the same data produce the same strings', () => {
    // The reconciler commits on output-equality: a path that differs by float
    // noise re-commits every mark on every unrelated state change.
    const opts = { ...BOX, band: { low: 20, high: 80 }, min: 0, max: 100 }
    const a = sparklineGeometry(pts([12, 47, 63, 91]), opts)
    const b = sparklineGeometry(pts([12, 47, 63, 91]), { ...opts })
    expect(b.path).toBe(a.path)
    expect(b.band!.d).toBe(a.band!.d)
    expect(b.now.d).toBe(a.now.d)
    expect(b.ticks.map((t) => t.d)).toEqual(a.ticks.map((t) => t.d))
  })

  it('rounds a coordinate that raw arithmetic would print with float noise', () => {
    // 1 - (29 - 9.5) / (30.5 - 9.5), times 40, is 2.857142857142856 in
    // double arithmetic. `fmt` is the only reason it does not reach the path.
    const g = geo(pts([29, 10]), { min: 9.5, max: 30.5 })
    expect(g.path).toBe('M0,2.857L100,39.048')
    expect(g.path).not.toMatch(/\d\.\d{4,}/)
  })

  it('no coordinate anywhere in the geometry carries more than 3 decimals', () => {
    const g = sparklineGeometry(pts([1 / 3, 2 / 3, 1 / 7, 22 / 7]), {
      ...BOX,
      band: { low: 1 / 3, high: 22 / 7 },
      track: { height: 1 / 3, gap: 1 / 7 },
    })
    const strings = [g.path, g.band!.d, g.now.d, ...g.ticks.map((t) => t.d)]
    for (const s of strings) expect(s).not.toMatch(/\d\.\d{4,}/)
  })
})

// ── The reference band ────────────────────────────────────────────────────

describe('sparkline — the reference band reads all three ways', () => {
  const base = { ...BOX, min: 0, max: 100 }

  it('BOTH bounds shade between them', () => {
    const g = sparklineGeometry(pts([50]), { ...base, band: { low: 20, high: 80 } })
    expect(g.band).toEqual({ kind: 'between', low: 20, high: 80, d: 'M0,8L100,8L100,32L0,32Z' })
  })

  it('a HIGH alone shades everything below it', () => {
    const g = sparklineGeometry(pts([50]), { ...base, band: { high: 80 } })
    expect(g.band!.kind).toBe('below')
    expect(g.band!.low).toBeNull()
    // From the value-axis floor (y = 40) up to 80 (y = 8).
    expect(g.band!.d).toBe('M0,8L100,8L100,40L0,40Z')
  })

  it('a LOW alone shades everything above it', () => {
    const g = sparklineGeometry(pts([50]), { ...base, band: { low: 20 } })
    expect(g.band!.kind).toBe('above')
    expect(g.band!.high).toBeNull()
    expect(g.band!.d).toBe('M0,0L100,0L100,32L0,32Z')
  })

  it('NEITHER bound draws no band at all', () => {
    expect(sparklineGeometry(pts([50]), base).band).toBeNull()
    expect(sparklineGeometry(pts([50]), { ...base, band: {} }).band).toBeNull()
  })

  it('treats a non-finite bound as absent, never as a bound of ±Infinity', () => {
    const g = sparklineGeometry(pts([50]), {
      ...base,
      band: { low: Number.NEGATIVE_INFINITY, high: 80 },
    })
    expect(g.band!.kind).toBe('below')
    expect(g.band!.low).toBeNull()
  })

  it('does NOT force zero into the value axis the way a bar chart must', () => {
    // `valueDomain` always includes 0 because a bar's LENGTH states its
    // magnitude. A trend line's shape is the message, so a 118–142 series has
    // to fill the box instead of smearing across the top of a 0–142 axis.
    const g = geo(pts([118, 142]))
    expect(g.value.min).toBeGreaterThan(100)
    expect(g.value.max).toBeLessThan(150)
    // …and it still leaves breathing room, so the line never touches the edge.
    expect(g.value.min).toBeLessThan(118)
    expect(g.value.max).toBeGreaterThan(142)
  })

  it('EXPANDS the value axis to include the band, so its edge is never off-screen', () => {
    // Without the band the axis would be 118..142; the 90 low has to be visible
    // or the shading means nothing.
    const g = geo(pts([118, 142]), { band: { low: 90, high: 120 } })
    expect(g.value.min).toBeLessThanOrEqual(90)
    expect(g.value.max).toBeGreaterThanOrEqual(142)
  })
})

// ── Per-point tone ────────────────────────────────────────────────────────

describe('sparkline — each point is classified against the band', () => {
  const tones = (band: SparklineGeometryOptions['band'], values: number[]) =>
    geo(pts(values), { band, min: 0, max: 100 }).dots.map((d) => d.tone)

  it('below / in / above against both bounds', () => {
    expect(tones({ low: 20, high: 80 }, [10, 50, 90])).toEqual(['below', 'in', 'above'])
  })

  it('a bound is INCLUSIVE — a reading exactly on it is inside', () => {
    expect(tones({ low: 20, high: 80 }, [20, 80])).toEqual(['in', 'in'])
  })

  it('a high-only band can never call a reading LOW', () => {
    expect(tones({ high: 80 }, [-999, 50, 90])).toEqual(['in', 'in', 'above'])
  })

  it('a low-only band can never call a reading HIGH', () => {
    expect(tones({ low: 20 }, [10, 50, 9999])).toEqual(['below', 'in', 'in'])
  })

  it("with no band at all the tone is 'none', not a silent 'in'", () => {
    expect(tones(undefined, [10, 50, 90])).toEqual(['none', 'none', 'none'])
  })

  it('marks the LAST point and only the last', () => {
    const g = geo(pts([1, 2, 3]))
    expect(g.dots.map((d) => d.last)).toEqual([false, false, true])
  })

  it('marks the ACTIVE point, and nothing when the cursor is clear', () => {
    expect(geo(pts([1, 2, 3]), { activeIndex: 1 }).dots.map((d) => d.active)).toEqual([
      false,
      true,
      false,
    ])
    expect(geo(pts([1, 2, 3])).dots.some((d) => d.active)).toBe(false)
  })
})

// ── The "now" right edge ──────────────────────────────────────────────────

describe('sparkline — the right edge is "now", so a stale series trails off', () => {
  it('defaults to the last reading, and is then NOT stale', () => {
    const g = geo(pts([1, 2, 3]))
    expect(g.now.at).toBe(T0 + 2 * DAY)
    expect(g.now.stale).toBe(false)
    expect(g.dots[2]!.x).toBe(100)
    expect(g.summary.stale).toBe(false)
  })

  it('a later "now" pulls the last reading off the right edge', () => {
    const g = geo(pts([1, 2, 3]), { now: T0 + 4 * DAY })
    expect(g.now.stale).toBe(true)
    // The series spans 2 of the 4 days, so the last dot sits at the midpoint.
    expect(g.dots[2]!.x).toBe(50)
    expect(g.now.d).toBe('M100,40L100,0')
  })

  it('a "now" BEFORE the last reading is clamped — the edge cannot precede the data', () => {
    const g = geo(pts([1, 2, 3]), { now: T0 })
    expect(g.now.at).toBe(T0 + 2 * DAY)
    expect(g.now.stale).toBe(false)
  })

  it('is never derived from Date.now() — geometry stays a pure function of state', () => {
    // Two calls a moment apart must be identical, or an SSR render and the
    // first client render disagree and every gridline rewrites.
    const a = geo(pts([1, 2, 3]))
    const b = geo(pts([1, 2, 3]))
    expect(b.now).toEqual(a.now)
    expect(b.path).toBe(a.path)
  })
})

// ── Leading-outlier trimming ──────────────────────────────────────────────

describe('sparkline — leading-outlier trimming is opt-in and bounded', () => {
  /** One ancient reading, then a dense recent cluster. */
  const stranded = (): SparklinePoint[] => [
    { at: T0, value: 10 },
    ...Array.from({ length: 8 }, (_, i) => ({ at: T0 + 365 * DAY + i * DAY, value: 20 + i })),
  ]

  it('is OFF by default — a chart that silently drops a reading is worse', () => {
    const g = geo(stranded())
    expect(g.points).toHaveLength(9)
    expect(g.trimmed).toBe(0)
    expect(g.summary.trimmed).toBe(0)
  })

  it('drops the stranded leader when asked, and reports how many went', () => {
    const g = geo(stranded(), { trim: { factor: 4, floor: 3 } })
    expect(g.trimmed).toBe(1)
    expect(g.points).toHaveLength(8)
    expect(g.points[0]!.at).toBe(T0 + 365 * DAY)
    expect(g.summary.trimmed).toBe(1)
    expect(g.summary.from).toBe(isoDay(T0 + 365 * DAY))
  })

  it('stops as soon as the leading gap is PROPORTIONATE', () => {
    // Only the first gap is disproportionate; the walk must not keep eating.
    const { points, trimmed } = trimLeadingOutliers(stranded(), { factor: 4, floor: 3 })
    expect(trimmed).toBe(1)
    expect(points).toHaveLength(8)
  })

  it('drops SEVERAL leaders when several are stranded', () => {
    const two = [
      { at: T0, value: 1 },
      { at: T0 + 300 * DAY, value: 2 },
      ...Array.from({ length: 6 }, (_, i) => ({ at: T0 + 700 * DAY + i * DAY, value: 3 })),
    ]
    expect(trimLeadingOutliers(two, { factor: 4, floor: 3 }).trimmed).toBe(2)
  })

  it('respects the FLOOR — it never trims a short series down to nothing', () => {
    const short = [
      { at: T0, value: 1 },
      { at: T0 + 1000 * DAY, value: 2 },
      { at: T0 + 1001 * DAY, value: 3 },
      { at: T0 + 1002 * DAY, value: 4 },
    ]
    expect(trimLeadingOutliers(short, { factor: 4, floor: 3 }).trimmed).toBe(1)
    // At a floor of 4 the same series is already at the floor: nothing goes.
    expect(trimLeadingOutliers(short, { factor: 4, floor: 4 }).trimmed).toBe(0)
  })

  it('never leaves fewer than 2 points, whatever floor it is handed', () => {
    // The OBSERVABLE invariant, stated as such: a mutation of the
    // `Math.max(2, …)` guard survives this, because with two points left the
    // trailing gaps are empty and the zero-median break already stops the
    // walk. Asserting the guard directly would be asserting an implementation
    // detail that nothing can reach.
    const runaway = [
      { at: T0, value: 1 },
      { at: T0 + 3000 * DAY, value: 2 },
      { at: T0 + 3100 * DAY, value: 3 },
    ]
    expect(trimLeadingOutliers(runaway, { factor: 1.5, floor: 0 }).points.length).toBe(2)
    expect(trimLeadingOutliers(runaway, { factor: 1.5, floor: -99 }).points.length).toBe(2)
  })

  it('turns OFF for a factor of 1 or less rather than calling every gap outlying', () => {
    const even = pts([1, 2, 3, 4, 5])
    expect(trimLeadingOutliers(even, { factor: 1, floor: 3 }).trimmed).toBe(0)
    expect(trimLeadingOutliers(even, { factor: 0.5, floor: 3 }).trimmed).toBe(0)
  })

  it('leaves an EVENLY sampled series completely alone', () => {
    expect(trimLeadingOutliers(pts([1, 2, 3, 4, 5]), { factor: 4, floor: 3 }).trimmed).toBe(0)
  })

  it('stops on a ZERO median instead of eating the series', () => {
    // Every remaining reading at the same instant: there is no yardstick, and
    // `lead > 4 * 0` would otherwise be true forever.
    const piled = [
      { at: T0, value: 1 },
      { at: T0 + 100 * DAY, value: 2 },
      { at: T0 + 100 * DAY, value: 3 },
      { at: T0 + 100 * DAY, value: 4 },
      { at: T0 + 100 * DAY, value: 5 },
    ]
    expect(trimLeadingOutliers(piled, { factor: 4, floor: 3 }).trimmed).toBe(0)
  })

  it('uses the MEDIAN, so one more ancient gap cannot inflate the yardstick', () => {
    // Mean of the trailing gaps is dragged up by the 400-day one; the median
    // stays at 1 day and the leader is still recognised.
    const skewed = [
      { at: T0, value: 1 },
      { at: T0 + 100 * DAY, value: 2 },
      { at: T0 + 500 * DAY, value: 3 },
      { at: T0 + 501 * DAY, value: 4 },
      { at: T0 + 502 * DAY, value: 5 },
      { at: T0 + 503 * DAY, value: 6 },
      { at: T0 + 504 * DAY, value: 7 },
    ]
    expect(trimLeadingOutliers(skewed, { factor: 4, floor: 3 }).trimmed).toBeGreaterThan(0)
  })

  it('never mutates the caller’s array', () => {
    const input = stranded()
    const copy = [...input]
    trimLeadingOutliers(input, { factor: 4, floor: 3 })
    expect(input).toEqual(copy)
  })
})

// ── Calendar ticks, through the sparkline ─────────────────────────────────

describe('sparkline — gridlines land on calendar boundaries', () => {
  it('places a vertical rule at each boundary, positioned by the time domain', () => {
    // 2026-01-01 to 2026-01-05: five daily boundaries, at u = 0, .25, .5, …
    const g = geo(pts([1, 2, 3, 4, 5]), { calendar: { maxTicks: 6 } })
    expect(g.ticks.map((t) => t.unit)).toEqual(['day', 'day', 'day', 'day', 'day'])
    expect(g.ticks.map((t) => t.x)).toEqual([0, 25, 50, 75, 100])
    expect(g.ticks[1]!.d).toBe('M25,40L25,0')
  })

  it('coarsens the rung as the span grows, without the caller asking', () => {
    const daily = geo(pts([1, 2, 3, 4]), { calendar: { maxTicks: 4 } })
    const yearly = geo(
      [
        { at: Date.UTC(2019, 0, 1), value: 1 },
        { at: Date.UTC(2026, 0, 1), value: 2 },
      ],
      { calendar: { maxTicks: 4 } },
    )
    expect(daily.ticks[0]!.unit).toBe('day')
    expect(yearly.ticks[0]!.unit).toBe('year')
    expect(yearly.ticks.length).toBeLessThanOrEqual(4)
  })

  it('gives each tick a key stable across recomputation', () => {
    const a = geo(pts([1, 2, 3]))
    const b = geo(pts([1, 2, 3]))
    expect(b.ticks.map((t) => t.key)).toEqual(a.ticks.map((t) => t.key))
  })

  it('emits no gridlines when there is no data', () => {
    expect(geo([]).ticks).toEqual([])
  })
})

// ── The granularity track ─────────────────────────────────────────────────

describe('sparkline — the granularity track says where the sampling changed', () => {
  const grained = (grains: (string | undefined)[]): SparklinePoint[] =>
    grains.map((grain, i) => {
      const p: SparklinePoint = { at: T0 + i * DAY, value: 10 + i }
      if (grain !== undefined) p.grain = grain
      return p
    })

  const TRACKED: SparklineGeometryOptions = {
    ...BOX,
    track: { height: 4, gap: 2 },
    padding: { top: 0, right: 0, bottom: 10, left: 0 },
  }

  it('groups consecutive equal grains into one segment', () => {
    const g = sparklineGeometry(grained(['spot', 'spot', 'daily', 'daily']), TRACKED)
    expect(g.spans.map((s) => s.grain)).toEqual(['spot', 'daily'])
  })

  it('a segment runs to the START of the next one, so a lone reading is visible', () => {
    const g = sparklineGeometry(grained(['spot', 'daily', 'daily', 'daily']), TRACKED)
    // Frame is 100 wide over 3 days: the first segment covers day 0 to day 1.
    expect(g.spans[0]!.grain).toBe('spot')
    expect(g.spans[0]!.x0).toBe(0)
    expect(g.spans[0]!.x1).toBeCloseTo(100 / 3, 9)
    expect(g.spans[0]!.x1).toBeGreaterThan(g.spans[0]!.x0)
    // The emitted rect goes through `fmt`, so the float noise never lands in
    // the DOM even though the computed x does carry it.
    expect(g.spans[0]!.d).toBe('M0,32L33.333,32L33.333,36L0,36Z')
    expect(g.spans[1]).toMatchObject({ grain: 'daily', x1: 100 })
  })

  it('the last segment runs to the RIGHT EDGE, not to its own last reading', () => {
    const g = sparklineGeometry(grained(['spot', 'spot', 'spot']), {
      ...TRACKED,
      now: T0 + 10 * DAY,
    })
    expect(g.spans).toHaveLength(1)
    expect(g.spans[0]!.x1).toBe(100)
    expect(g.spans[0]!.to).toBe(T0 + 10 * DAY)
  })

  it('leaves a real GAP where the resolution is unstated', () => {
    const g = sparklineGeometry(grained(['a', undefined, 'b']), TRACKED)
    expect(g.spans.map((s) => s.grain)).toEqual(['a', 'b'])
    // The untagged stretch tiles, so 'a' cannot bleed across it.
    expect(g.spans[0]!.x1).toBeLessThan(g.spans[1]!.x0)
  })

  it('sits in the bottom padding, below the plot frame', () => {
    const g = sparklineGeometry(grained(['spot', 'spot']), TRACKED)
    // frame.height = 40 - 0 - 10 = 30; top = 0 + 30 + 2 = 32; bottom = 36.
    expect(g.frame.height).toBe(30)
    expect(g.spans[0]!.d).toBe('M0,32L100,32L100,36L0,36Z')
  })

  it('emits nothing when no point carries a grain, or when the track is off', () => {
    expect(sparklineGeometry(grained([undefined, undefined]), TRACKED).spans).toEqual([])
    expect(
      sparklineGeometry(grained(['spot', 'daily']), { ...TRACKED, track: null }).spans,
    ).toEqual([])
  })
})

// ── Accessibility ─────────────────────────────────────────────────────────

describe('sparkline — the readable fallback', () => {
  it('composes a label from the count and the calendar range', () => {
    expect(geo(pts([1, 2, 3])).label).toBe('Trend of 3 readings, 2026-01-01 to 2026-01-03')
  })

  it('says something sensible for one reading and for none', () => {
    expect(geo(pts([1])).label).toBe('1 reading, 2026-01-01')
    expect(geo([]).label).toBe('No readings')
  })

  it('phrases the SAME facts differently when handed different strings', () => {
    const summary = geo(pts([1, 2, 3])).summary
    expect(
      sparklineLabel(summary, { empty: 'niente', range: (n, a, b) => `${n} da ${a} a ${b}` }),
    ).toBe('3 da 2026-01-01 a 2026-01-03')
  })

  it('emits a table row per drawn reading, carrying value, tone and grain', () => {
    const g = geo(
      [
        { at: T0, value: 10, grain: 'spot' },
        { at: T0 + DAY, value: 90 },
      ],
      { band: { low: 20, high: 80 }, min: 0, max: 100 },
    )
    expect(g.rows).toEqual([
      { at: T0, day: '2026-01-01', value: 10, tone: 'below', grain: 'spot' },
      { at: T0 + DAY, day: '2026-01-02', value: 90, tone: 'above', grain: null },
    ])
  })

  it('the rows describe the DRAWN series — trimmed readings are not in the table', () => {
    const g = geo(
      [
        { at: T0, value: 1 },
        ...Array.from({ length: 8 }, (_, i) => ({ at: T0 + 365 * DAY + i * DAY, value: 2 })),
      ],
      { trim: { factor: 4, floor: 3 } },
    )
    expect(g.rows).toHaveLength(8)
    expect(g.rows[0]!.day).toBe(isoDay(T0 + 365 * DAY))
  })

  it('isoDay reports the day in the CONFIGURED offset, not the ambient zone', () => {
    const t = Date.UTC(2026, 0, 1, 2, 0, 0)
    expect(isoDay(t)).toBe('2026-01-01')
    expect(isoDay(t, { offsetMinutes: -300 })).toBe('2025-12-31')
    expect(isoDay(t, { offsetMinutes: 330 })).toBe('2026-01-01')
  })

  it('pads a short year rather than emitting a 3-character date', () => {
    expect(isoDay(new Date('0042-06-15T00:00:00Z').getTime())).toBe('0042-06-15')
  })
})

// ── The hit test ──────────────────────────────────────────────────────────

describe('sparkline — locateIndex', () => {
  it('returns the nearest drawn point by x', () => {
    const g = geo(pts([0, 50, 100]))
    expect(locateIndex(g, 0)).toBe(0)
    expect(locateIndex(g, 24)).toBe(0)
    expect(locateIndex(g, 26)).toBe(1)
    expect(locateIndex(g, 999)).toBe(2)
  })

  it('answers null with nothing to hit, and for a non-finite position', () => {
    expect(locateIndex(geo([]), 10)).toBeNull()
    expect(locateIndex(geo(pts([1, 2])), NaN)).toBeNull()
  })
})

// ── State and the reducer ─────────────────────────────────────────────────

describe('sparkline — state shape', () => {
  it('is JSON-serializable and round-trips key-for-key', () => {
    const s = state()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('OMITS an absent bound rather than storing undefined or ±Infinity (#177)', () => {
    const s = init()
    expect('now' in s).toBe(false)
    expect('min' in s).toBe(false)
    expect('max' in s).toBe(false)
    expect('low' in s.band).toBe(false)
    expect('high' in s.band).toBe(false)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('drops a non-finite bound at init rather than storing it', () => {
    const s = init({ now: NaN, min: Number.NEGATIVE_INFINITY, band: { high: Infinity, low: 4 } })
    expect('now' in s).toBe(false)
    expect('min' in s).toBe(false)
    expect(s.band).toEqual({ low: 4 })
  })

  it('leaves trimming OFF unless asked, and takes `true` for the defaults', () => {
    expect(init().trim).toBeNull()
    expect(init({ trim: false }).trim).toBeNull()
    expect(init({ trim: true }).trim).toEqual({ factor: 4, floor: 3 })
    expect(init({ trim: { floor: 5 } }).trim).toEqual({ factor: 4, floor: 5 })
  })
})

describe('sparkline — update', () => {
  it('setActive clamps into the DRAWN range and accepts null', () => {
    expect(step(state(), { type: 'setActive', index: 1 }).activeIndex).toBe(1)
    expect(step(state(), { type: 'setActive', index: 99 }).activeIndex).toBe(2)
    expect(step(state(), { type: 'setActive', index: -4 }).activeIndex).toBe(0)
    expect(step(state(), { type: 'setActive', index: null }).activeIndex).toBeNull()
    expect(step(state(), { type: 'setActive', index: NaN }).activeIndex).toBeNull()
  })

  it('setActive clamps against the TRIMMED list, not the raw points', () => {
    const s = state({
      points: [
        { at: T0, value: 1 },
        ...Array.from({ length: 4 }, (_, i) => ({ at: T0 + 365 * DAY + i * DAY, value: 2 })),
      ],
      trim: { factor: 4, floor: 3 },
    })
    // Five points in, four drawn: index 4 does not exist.
    expect(geometry(s).dots).toHaveLength(4)
    expect(step(s, { type: 'setActive', index: 4 }).activeIndex).toBe(3)
  })

  it('moveActive walks and CLAMPS at the ends rather than wrapping', () => {
    const s = step(state(), { type: 'setActive', index: 1 })
    expect(step(s, { type: 'moveActive', delta: 1 }).activeIndex).toBe(2)
    expect(step(s, { type: 'moveActive', delta: 5 }).activeIndex).toBe(2)
    expect(step(s, { type: 'moveActive', delta: -5 }).activeIndex).toBe(0)
  })

  it('moveActive from no cursor enters at the near end, in the direction of travel', () => {
    expect(step(state(), { type: 'moveActive', delta: 1 }).activeIndex).toBe(0)
    expect(step(state(), { type: 'moveActive', delta: -1 }).activeIndex).toBe(2)
  })

  it('firstActive / lastActive jump to the ends', () => {
    expect(step(state(), { type: 'firstActive' }).activeIndex).toBe(0)
    expect(step(state(), { type: 'lastActive' }).activeIndex).toBe(2)
  })

  it('every cursor message is inert with no points', () => {
    const empty = state({ points: [] })
    for (const msg of [
      { type: 'moveActive', delta: 1 },
      { type: 'firstActive' },
      { type: 'lastActive' },
      { type: 'setActive', index: 0 },
    ] as SparklineMsg[]) {
      expect(step(empty, msg).activeIndex).toBeNull()
    }
  })

  it('setPoints re-clamps a cursor that the new series no longer has', () => {
    const s = step(state(), { type: 'lastActive' })
    expect(s.activeIndex).toBe(2)
    expect(step(s, { type: 'setPoints', points: pts([7] as number[]) }).activeIndex).toBe(0)
    expect(step(s, { type: 'setPoints', points: [] }).activeIndex).toBeNull()
  })

  it('setNow writes a finite instant and DELETES the key for null', () => {
    const withNow = step(state(), { type: 'setNow', at: T0 + 9 * DAY })
    expect(withNow.now).toBe(T0 + 9 * DAY)
    const cleared = step(withNow, { type: 'setNow', at: null })
    expect('now' in cleared).toBe(false)
    expect(JSON.parse(JSON.stringify(cleared))).toEqual(cleared)
  })

  it('setBand omits the side it is given null for', () => {
    const both = step(state(), { type: 'setBand', low: 20, high: 80 })
    expect(both.band).toEqual({ low: 20, high: 80 })
    const highOnly = step(both, { type: 'setBand', low: null, high: 80 })
    expect('low' in highOnly.band).toBe(false)
    expect(JSON.parse(JSON.stringify(highOnly))).toEqual(highOnly)
  })

  it('setSize keeps the previous size when handed a non-finite one', () => {
    expect(step(state(), { type: 'setSize', width: 200, height: 60 })).toMatchObject({
      width: 200,
      height: 60,
    })
    expect(step(state(), { type: 'setSize', width: NaN, height: Infinity })).toMatchObject({
      width: 100,
      height: 40,
    })
  })

  it('emits no effects, ever', () => {
    for (const msg of [
      { type: 'setActive', index: 1 },
      { type: 'moveActive', delta: 1 },
      { type: 'firstActive' },
      { type: 'lastActive' },
      { type: 'setPoints', points: [] },
      { type: 'setNow', at: null },
      { type: 'setBand', low: null, high: null },
      { type: 'setSize', width: 10, height: 10 },
    ] as SparklineMsg[]) {
      expect(update(state(), msg)[1]).toEqual([])
    }
  })

  it('returns a NEW state object — an in-place mutation is invisible to the reconciler', () => {
    const before = state()
    const after = step(before, { type: 'setActive', index: 1 })
    expect(after).not.toBe(before)
    expect(before.activeIndex).toBeNull()
  })
})

// ── connect ───────────────────────────────────────────────────────────────

describe('sparkline — connect over a STATELESS signal', () => {
  const parts = connect(constant(state()), noSend, { id: 'bp' })

  it('works with constant()/noSend — no hoisted state slice needed', () => {
    expect(parts.svg.role).toBe('img')
    expect(parts.svg['aria-labelledby']).toBe('bp:title bp:desc')
    expect(parts.title.id).toBe('bp:title')
    expect(parts.desc.id).toBe('bp:desc')
  })

  it('a handler wired to noSend is inert rather than throwing', () => {
    expect(() =>
      parts.svg.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' })),
    ).not.toThrow()
  })
})

describe('sparkline — connect part bag', () => {
  const sig = rootSignal<SparklineState>()
  const parts = connect(sig, noSend, { id: 'bp' })

  it('names a part on every drawn layer', () => {
    expect(parts.root['data-part']).toBe('root')
    expect(parts.svg['data-part']).toBe('svg')
    expect(parts.band['data-part']).toBe('band')
    expect(parts.line['data-part']).toBe('line')
    expect(parts.now['data-part']).toBe('now')
    expect(parts.layer['data-part']).toBe('layer')
    expect(parts.table['data-part']).toBe('table')
    expect(parts.tooltip['data-part']).toBe('tooltip')
    const dot = rootSignal<SparklineDot>()
    expect(parts.dotProps(dot)['data-part']).toBe('dot')
    expect(parts.tickProps(rootSignal())['data-part']).toBe('grid')
    expect(parts.spanProps(rootSignal())['data-part']).toBe('span')
    for (const bag of [parts.root, parts.svg, parts.band, parts.line, parts.now, parts.layer]) {
      expect(bag['data-scope']).toBe('sparkline')
    }
  })

  it('publishes the viewBox from the state size', () => {
    expect(read(parts.svg.viewBox, state())).toBe('0 0 100 40')
    expect(read(parts.svg.viewBox, state({ width: 240, height: 64 }))).toBe('0 0 240 64')
  })

  it('hides the band bag rather than unmounting it', () => {
    expect(read(parts.band.hidden, state())).toBe(true)
    expect(read(parts.band.d, state())).toBe('')
    const banded = state({ band: { low: 20, high: 80 } })
    expect(read(parts.band.hidden, banded)).toBe(false)
    expect(read(parts.band['data-band'], banded)).toBe('between')
    expect(read(parts.band.d, banded)).toBe('M0,8L100,8L100,32L0,32Z')
  })

  it('publishes the line and the right-edge rule as reactive `d`s', () => {
    expect(read(parts.line.d, state())).toBe('M0,40L50,20L100,0')
    expect(read(parts.now.d, state())).toBe('M100,40L100,0')
  })

  it('flags staleness on the root and the edge, bare (’’ / undefined)', () => {
    expect(read(parts.root['data-stale'], state())).toBeUndefined()
    const stale = state({ now: T0 + 9 * DAY })
    expect(read(parts.root['data-stale'], stale)).toBe('')
    expect(read(parts.now['data-stale'], stale)).toBe('')
  })

  it('publishes the cursor on the root and hides the tooltip when there is none', () => {
    expect(read(parts.root['data-active'], state())).toBeUndefined()
    expect(read(parts.tooltip.hidden, state())).toBe(true)
    const active = state({ activeIndex: 1 })
    expect(read(parts.root['data-active'], active)).toBe('')
    expect(read(parts.tooltip.hidden, active)).toBe(false)
    expect(read(parts.tooltip.style, active)).toBe('left:50%;top:50%')
    expect(read(parts.activeDot, active)?.index).toBe(1)
  })

  it('per-row bags take the ROW SIGNAL, so a reused keyed row cannot go stale', () => {
    const dot: SparklineDot = {
      index: 1,
      at: T0,
      value: 5,
      x: 12.5,
      y: 30,
      tone: 'above',
      last: true,
      active: true,
      key: '1:0',
    }
    const bag = parts.dotProps(rootSignal<SparklineDot>())
    expect(read(bag.cx, dot)).toBe(12.5)
    expect(read(bag.cy, dot)).toBe(30)
    expect(read(bag['data-tone'], dot)).toBe('above')
    expect(read(bag['data-last'], dot)).toBe('')
    expect(read(bag['data-active'], dot)).toBe('')
    expect(read(bag['data-last'], { ...dot, last: false, active: false })).toBeUndefined()
    expect(read(bag['data-active'], { ...dot, last: false, active: false })).toBeUndefined()
  })

  it('surfaces the geometry lists as signals for a keyed each', () => {
    const s = state()
    expect(read(parts.dots, s).map((d) => d.x)).toEqual([0, 50, 100])
    expect(read(parts.ticks, s).map((t) => t.unit)).toEqual(['day', 'day', 'day'])
    expect(read(parts.rows, s)).toHaveLength(3)
    expect(read(parts.spans, s)).toEqual([])
  })

  it('names the chart from the locale, and lets an option override it', () => {
    expect(read(parts.label, state())).toBe('Trend of 3 readings, 2026-01-01 to 2026-01-03')
    expect(read(parts.table['aria-label'], state())).toBe(read(parts.label, state()))
    const named = connect(sig, noSend, { id: 'bp', label: 'Systolic over time' })
    expect(read(named.label, state())).toBe('Systolic over time')
    expect(read(named.table['aria-label'], state())).toBe('Systolic over time')
  })

  it('dispatches cursor messages from the keyboard, tagged for the agent surface', () => {
    const sent: SparklineMsg[] = []
    const live = connect(constant(state()), (m: SparklineMsg) => sent.push(m), { id: 'bp' })
    const key = (k: string) => live.svg.onKeyDown(new KeyboardEvent('keydown', { key: k }))
    key('ArrowRight')
    key('ArrowLeft')
    key('Home')
    key('End')
    expect(sent.map((m) => m.type)).toEqual([
      'moveActive',
      'moveActive',
      'firstActive',
      'lastActive',
    ])
  })

  it('Escape clears the cursor only when there IS one', () => {
    const sent: SparklineMsg[] = []
    const idle = connect(constant(state()), (m: SparklineMsg) => sent.push(m), { id: 'bp' })
    idle.svg.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(sent).toEqual([])
    const active = connect(constant(state({ activeIndex: 1 })), (m: SparklineMsg) => sent.push(m), {
      id: 'bp',
    })
    active.svg.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(sent).toEqual([{ type: 'setActive', index: null }])
  })

  it('ignores the keyboard entirely when there is nothing plotted', () => {
    const sent: SparklineMsg[] = []
    const empty = connect(constant(state({ points: [] })), (m: SparklineMsg) => sent.push(m), {
      id: 'bp',
    })
    empty.svg.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(sent).toEqual([])
  })

  it('declares the tagSend variants its handlers actually dispatch', () => {
    const variants = (fn: unknown): readonly string[] =>
      (fn as { __lluiVariants?: readonly string[] }).__lluiVariants ?? []
    expect(variants(parts.svg.onKeyDown)).toEqual([
      'moveActive',
      'firstActive',
      'lastActive',
      'setActive',
    ])
    expect(variants(parts.svg.onPointerLeave)).toEqual(['setActive'])
    expect(variants(parts.svg.onBlur)).toEqual(['setActive'])
  })
})

describe('sparkline — geometry() is memoized on state identity', () => {
  it('returns the same object for the same state and a fresh one otherwise', () => {
    const s = state()
    expect(geometry(s)).toBe(geometry(s))
    expect(geometry(state())).not.toBe(geometry(s))
  })
})
