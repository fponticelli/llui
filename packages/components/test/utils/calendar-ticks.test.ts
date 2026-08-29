import { describe, it, expect } from 'vitest'
import {
  MAX_CALENDAR_TICKS,
  addUnits,
  calendarTicks,
  chooseCalendarStep,
  countCalendarTicks,
  floorToUnit,
  type CalendarUnit,
} from '../../src/utils/calendar-ticks'

const at = (iso: string): number => new Date(iso).getTime()
const iso = (ms: number): string => new Date(ms).toISOString()
const HOUR = 3_600_000
const DAY = 86_400_000

describe('calendar-ticks — floorToUnit lands on real period boundaries', () => {
  const t = at('2026-03-17T14:37:12.345Z')

  it('floors to the hour, the day, the 1st of the month, the quarter and Jan 1', () => {
    expect(iso(floorToUnit(t, 'hour'))).toBe('2026-03-17T14:00:00.000Z')
    expect(iso(floorToUnit(t, 'day'))).toBe('2026-03-17T00:00:00.000Z')
    expect(iso(floorToUnit(t, 'month'))).toBe('2026-03-01T00:00:00.000Z')
    expect(iso(floorToUnit(t, 'quarter'))).toBe('2026-01-01T00:00:00.000Z')
    expect(iso(floorToUnit(t, 'year'))).toBe('2026-01-01T00:00:00.000Z')
  })

  it('floors to a MONDAY by default and honours weekStartsOn', () => {
    // 2026-03-17 is a Tuesday.
    expect(new Date(t).getUTCDay()).toBe(2)
    expect(iso(floorToUnit(t, 'week'))).toBe('2026-03-16T00:00:00.000Z')
    expect(iso(floorToUnit(t, 'week', { weekStartsOn: 0 }))).toBe('2026-03-15T00:00:00.000Z')
    expect(iso(floorToUnit(t, 'week', { weekStartsOn: 3 }))).toBe('2026-03-11T00:00:00.000Z')
  })

  it('wraps an out-of-range weekStartsOn into a real weekday rather than rotating', () => {
    expect(floorToUnit(t, 'week', { weekStartsOn: 8 })).toBe(
      floorToUnit(t, 'week', { weekStartsOn: 1 }),
    )
    expect(floorToUnit(t, 'week', { weekStartsOn: -1 })).toBe(
      floorToUnit(t, 'week', { weekStartsOn: 6 }),
    )
  })

  it('is IDEMPOTENT: a boundary is its own floor', () => {
    for (const unit of ['hour', 'day', 'week', 'month', 'quarter', 'year'] as CalendarUnit[]) {
      const b = floorToUnit(t, unit)
      expect(floorToUnit(b, unit)).toBe(b)
    }
  })

  it('floors instants BEFORE the epoch too (Math.floor, not truncation toward zero)', () => {
    const old = at('1965-07-04T11:30:00Z')
    expect(iso(floorToUnit(old, 'day'))).toBe('1965-07-04T00:00:00.000Z')
    expect(iso(floorToUnit(old, 'month'))).toBe('1965-07-01T00:00:00.000Z')
  })

  it('does NOT fold a year 0-99 into the 1900s the way Date.UTC does', () => {
    // `Date.UTC(42, 0, 1)` is 1942. A boundary that silently relocated by
    // nineteen centuries would be invisible on any modern axis and wrong on a
    // historical one.
    const ancient = new Date('0042-06-15T00:00:00Z').getTime()
    expect(new Date(floorToUnit(ancient, 'year')).getUTCFullYear()).toBe(42)
  })

  it('answers NaN for a non-finite instant rather than inventing a boundary', () => {
    expect(Number.isNaN(floorToUnit(NaN, 'day'))).toBe(true)
    expect(Number.isNaN(floorToUnit(Infinity, 'month'))).toBe(true)
  })
})

describe('calendar-ticks — the offset is FIXED, and DST is deliberately not followed', () => {
  it('shifts the day boundary by the offset', () => {
    const t = at('2026-03-17T02:00:00Z')
    // At UTC-5 the local day began at 05:00Z on the 17th; 02:00Z is still the
    // 16th locally, so the floor is the PREVIOUS 05:00Z.
    expect(iso(floorToUnit(t, 'day', { offsetMinutes: -300 }))).toBe('2026-03-16T05:00:00.000Z')
    expect(iso(floorToUnit(t, 'day', { offsetMinutes: 0 }))).toBe('2026-03-17T00:00:00.000Z')
  })

  it('shifts the MONTH boundary too, so "the 1st" means the 1st in that offset', () => {
    const t = at('2026-03-01T02:00:00Z')
    expect(iso(floorToUnit(t, 'month', { offsetMinutes: -300 }))).toBe('2026-02-01T05:00:00.000Z')
    expect(iso(floorToUnit(t, 'month', { offsetMinutes: 0 }))).toBe('2026-03-01T00:00:00.000Z')
  })

  it('handles a half-hour offset (Asia/Kolkata is +330)', () => {
    const t = at('2026-03-17T10:00:00Z')
    expect(iso(floorToUnit(t, 'day', { offsetMinutes: 330 }))).toBe('2026-03-16T18:30:00.000Z')
  })

  it('keeps day boundaries EXACTLY 24h apart across a real DST transition', () => {
    // 2026-03-08 is the US spring-forward date. A fixed offset does not follow
    // it — that is the guarantee, and it is what makes the O(1) counting sound.
    const ticks = calendarTicks(at('2026-03-05T00:00:00Z'), at('2026-03-12T00:00:00Z'), {
      unit: 'day',
      offsetMinutes: -300,
    })
    expect(ticks.length).toBeGreaterThan(2)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.at - ticks[i - 1]!.at).toBe(DAY)
    }
    // Every boundary is 05:00Z — never 04:00Z — for the whole span.
    for (const t of ticks) expect(iso(t.at).slice(11)).toBe('05:00:00.000Z')
  })

  it('a non-finite offset reads as UTC rather than poisoning every boundary', () => {
    const t = at('2026-03-17T14:00:00Z')
    expect(floorToUnit(t, 'day', { offsetMinutes: NaN })).toBe(floorToUnit(t, 'day'))
  })
})

describe('calendar-ticks — addUnits is calendar arithmetic above the week', () => {
  it('adds hours, days and weeks as fixed milliseconds', () => {
    const t = at('2026-03-17T00:00:00Z')
    expect(addUnits(t, 'hour', 5) - t).toBe(5 * HOUR)
    expect(addUnits(t, 'day', 3) - t).toBe(3 * DAY)
    expect(addUnits(t, 'week', 2) - t).toBe(14 * DAY)
  })

  it('adds months without assuming a month is 30 days', () => {
    const jan = at('2026-01-01T00:00:00Z')
    expect(iso(addUnits(jan, 'month', 1))).toBe('2026-02-01T00:00:00.000Z')
    expect(iso(addUnits(jan, 'month', 2))).toBe('2026-03-01T00:00:00.000Z')
    // February is 28 days in 2026 and January 31 — a fixed 30-day step would
    // land mid-month on both.
    expect(addUnits(jan, 'month', 1) - jan).toBe(31 * DAY)
    expect(addUnits(addUnits(jan, 'month', 1), 'month', 1) - addUnits(jan, 'month', 1)).toBe(
      28 * DAY,
    )
  })

  it('crosses a year boundary in both directions', () => {
    expect(iso(addUnits(at('2026-11-01T00:00:00Z'), 'month', 3))).toBe('2027-02-01T00:00:00.000Z')
    expect(iso(addUnits(at('2026-02-01T00:00:00Z'), 'month', -3))).toBe('2025-11-01T00:00:00.000Z')
  })

  it('steps quarters by three months and years by twelve', () => {
    const q = at('2026-01-01T00:00:00Z')
    expect(iso(addUnits(q, 'quarter', 1))).toBe('2026-04-01T00:00:00.000Z')
    expect(iso(addUnits(q, 'quarter', 3))).toBe('2026-10-01T00:00:00.000Z')
    expect(iso(addUnits(q, 'year', 2))).toBe('2028-01-01T00:00:00.000Z')
  })
})

describe('calendar-ticks — counting is O(1) and agrees with generation', () => {
  const cases: { from: string; to: string; unit: CalendarUnit }[] = [
    { from: '2026-03-17T00:00:00Z', to: '2026-03-18T00:00:00Z', unit: 'hour' },
    { from: '2026-03-01T05:00:00Z', to: '2026-03-20T00:00:00Z', unit: 'day' },
    { from: '2026-01-01T00:00:00Z', to: '2026-04-01T00:00:00Z', unit: 'week' },
    { from: '2025-06-15T00:00:00Z', to: '2026-08-11T00:00:00Z', unit: 'month' },
    { from: '2020-02-03T00:00:00Z', to: '2026-08-11T00:00:00Z', unit: 'quarter' },
    { from: '1998-02-03T00:00:00Z', to: '2026-08-11T00:00:00Z', unit: 'year' },
  ]

  for (const c of cases) {
    it(`counts ${c.unit} boundaries without building them`, () => {
      const step = { unit: c.unit, stride: 1 }
      const counted = countCalendarTicks(at(c.from), at(c.to), step)
      const built = calendarTicks(at(c.from), at(c.to), { unit: c.unit, maxTicks: 100000 })
      expect(counted).toBe(built.length)
      expect(counted).toBeGreaterThan(0)
    })
  }

  it('includes a boundary that coincides with either end', () => {
    const from = at('2026-03-01T00:00:00Z')
    const to = at('2026-06-01T00:00:00Z')
    const ticks = calendarTicks(from, to, { unit: 'month', maxTicks: 100 })
    expect(ticks.map((t) => iso(t.at))).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ])
  })

  it('answers 0 (and returns nothing) when no boundary falls inside', () => {
    // Two instants inside the same month: no 1st between them.
    const from = at('2026-03-10T00:00:00Z')
    const to = at('2026-03-20T00:00:00Z')
    expect(countCalendarTicks(from, to, { unit: 'month', stride: 1 })).toBe(0)
    expect(calendarTicks(from, to, { unit: 'month' })).toEqual([])
  })

  it('returns [] for a reversed or non-finite range rather than looping', () => {
    expect(calendarTicks(at('2026-06-01T00:00:00Z'), at('2026-01-01T00:00:00Z'))).toEqual([])
    expect(calendarTicks(NaN, at('2026-01-01T00:00:00Z'))).toEqual([])
    expect(calendarTicks(0, Infinity)).toEqual([])
  })

  it('ascends, and every boundary is inside the range', () => {
    const from = at('2024-05-17T09:14:00Z')
    const to = at('2026-08-11T18:02:00Z')
    const ticks = calendarTicks(from, to, { maxTicks: 6 })
    expect(ticks.length).toBeGreaterThan(0)
    for (let i = 0; i < ticks.length; i++) {
      expect(ticks[i]!.at).toBeGreaterThanOrEqual(from)
      expect(ticks[i]!.at).toBeLessThanOrEqual(to)
      if (i > 0) expect(ticks[i]!.at).toBeGreaterThan(ticks[i - 1]!.at)
    }
  })
})

describe('calendar-ticks — the granularity ladder, at every rung boundary', () => {
  const unitFor = (fromIso: string, toIso: string, maxTicks = 6): CalendarUnit =>
    chooseCalendarStep(at(fromIso), at(toIso), { maxTicks }).unit

  it('picks HOUR for a span whose hourly boundaries fit', () => {
    expect(unitFor('2026-03-17T00:00:00Z', '2026-03-17T05:00:00Z')).toBe('hour')
  })

  it('steps HOUR → DAY at the point hours no longer fit', () => {
    // 6 hourly boundaries fit at maxTicks 6; the 7th does not.
    expect(unitFor('2026-03-17T00:00:00Z', '2026-03-17T05:00:00Z')).toBe('hour')
    expect(unitFor('2026-03-17T00:00:00Z', '2026-03-17T06:00:00Z')).toBe('day')
  })

  it('steps DAY → WEEK at the point days no longer fit', () => {
    expect(unitFor('2026-03-16T00:00:00Z', '2026-03-21T00:00:00Z')).toBe('day')
    expect(unitFor('2026-03-16T00:00:00Z', '2026-03-22T00:00:00Z')).toBe('week')
  })

  it('steps WEEK → MONTH at the point weeks no longer fit', () => {
    // Mondays from 2026-01-05: six of them reach 2026-02-09.
    expect(unitFor('2026-01-05T00:00:00Z', '2026-02-09T00:00:00Z')).toBe('week')
    expect(unitFor('2026-01-05T00:00:00Z', '2026-02-16T00:00:00Z')).toBe('month')
  })

  it('steps MONTH → QUARTER at the point months no longer fit', () => {
    expect(unitFor('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z')).toBe('month')
    expect(unitFor('2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z')).toBe('quarter')
  })

  it('steps QUARTER → YEAR at the point quarters no longer fit', () => {
    expect(unitFor('2026-01-01T00:00:00Z', '2027-04-01T00:00:00Z')).toBe('quarter')
    expect(unitFor('2026-01-01T00:00:00Z', '2027-07-01T00:00:00Z')).toBe('year')
  })

  it('never exceeds maxTicks at the rung it chooses', () => {
    const spans: [string, string][] = [
      ['2026-03-17T00:00:00Z', '2026-03-17T04:00:00Z'],
      ['2026-03-01T00:00:00Z', '2026-03-20T00:00:00Z'],
      ['2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z'],
      ['2024-01-01T00:00:00Z', '2026-08-11T00:00:00Z'],
      ['1850-01-01T00:00:00Z', '2026-08-11T00:00:00Z'],
    ]
    for (const max of [3, 4, 6, 10]) {
      for (const [from, to] of spans) {
        expect(calendarTicks(at(from), at(to), { maxTicks: max }).length).toBeLessThanOrEqual(max)
      }
    }
  })

  it('honours a FORCED unit even when the ladder would coarsen', () => {
    const ticks = calendarTicks(at('2026-01-01T00:00:00Z'), at('2026-01-20T00:00:00Z'), {
      unit: 'day',
      maxTicks: 4,
    })
    expect(ticks).toHaveLength(20)
    expect(ticks.every((t) => t.unit === 'day')).toBe(true)
  })
})

describe('calendar-ticks — the year rung grows a STRIDE instead of a unit', () => {
  it('picks decade, then quarter-century, then century boundaries', () => {
    const step = (from: string, to: string) => chooseCalendarStep(at(from), at(to), { maxTicks: 6 })
    expect(step('2000-01-01T00:00:00Z', '2005-01-01T00:00:00Z')).toEqual({
      unit: 'year',
      stride: 1,
    })
    expect(step('1980-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toEqual({
      unit: 'year',
      stride: 10,
    })
    expect(step('1500-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toEqual({
      unit: 'year',
      stride: 100,
    })
  })

  it('ALIGNS strided years, so the boundaries are decades and not an arbitrary phase', () => {
    const ticks = calendarTicks(at('1983-04-01T00:00:00Z'), at('2026-08-11T00:00:00Z'), {
      maxTicks: 6,
    })
    expect(ticks.map((t) => new Date(t.at).getUTCFullYear())).toEqual([1990, 2000, 2010, 2020])
    for (const t of ticks) expect(iso(t.at).slice(4)).toBe('-01-01T00:00:00.000Z')
  })

  it('forcing `year` still grows the stride — 400 gridlines is not "yearly"', () => {
    const ticks = calendarTicks(at('1600-01-01T00:00:00Z'), at('2026-01-01T00:00:00Z'), {
      unit: 'year',
      maxTicks: 6,
    })
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(ticks.every((t) => t.unit === 'year')).toBe(true)
  })
})

describe('calendar-ticks — the safety ceiling refuses rather than truncates', () => {
  it('returns [] when a FORCED unit would exceed MAX_CALENDAR_TICKS', () => {
    const from = at('1900-01-01T00:00:00Z')
    const to = at('2026-01-01T00:00:00Z')
    const wanted = countCalendarTicks(from, to, { unit: 'day', stride: 1 })
    expect(wanted).toBeGreaterThan(MAX_CALENDAR_TICKS)
    // A truncated axis would claim the data ends where the array does.
    expect(calendarTicks(from, to, { unit: 'day' })).toEqual([])
  })

  it('the AUTOMATIC ladder can never reach the ceiling', () => {
    const ticks = calendarTicks(at('1900-01-01T00:00:00Z'), at('2026-01-01T00:00:00Z'), {
      maxTicks: 6,
    })
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThanOrEqual(6)
  })
})
