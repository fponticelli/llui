import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  monthGrid,
  monthLabel,
  weekdayLabels,
  todayInTimeZone,
} from '../../src/components/date-picker'
import { rootSignal, read, signalOf } from '../_signal'

function rangeCell(iso: string, overrides: Record<string, unknown> = {}) {
  return {
    iso,
    day: Number(iso.slice(8)),
    inMonth: true,
    isToday: false,
    isSelected: false,
    isFocused: false,
    isDisabled: false,
    isRangeStart: false,
    isRangeEnd: false,
    isInRange: false,
    isUnavailable: false,
    ...overrides,
  }
}

describe('date-picker reducer', () => {
  it('initializes with visible month/year from value or today', () => {
    const s = init({ value: '2024-06-15' })
    expect(s.visibleYear).toBe(2024)
    expect(s.visibleMonth).toBe(6)
    expect(s.focused).toBe('2024-06-15')
  })

  it('setValue updates value and focused', () => {
    const [s] = update(init(), { type: 'setValue', value: '2024-03-10' })
    expect(s.value).toBe('2024-03-10')
    expect(s.focused).toBe('2024-03-10')
  })

  it('prevMonth/nextMonth navigate', () => {
    const s0 = init({ visibleYear: 2024, visibleMonth: 6 })
    expect(update(s0, { type: 'prevMonth' })[0].visibleMonth).toBe(5)
    expect(update(s0, { type: 'nextMonth' })[0].visibleMonth).toBe(7)
  })

  it('prevMonth wraps to December of prev year', () => {
    const s0 = init({ visibleYear: 2024, visibleMonth: 1 })
    const [s] = update(s0, { type: 'prevMonth' })
    expect(s.visibleMonth).toBe(12)
    expect(s.visibleYear).toBe(2023)
  })

  it('nextMonth wraps to January of next year', () => {
    const s0 = init({ visibleYear: 2024, visibleMonth: 12 })
    const [s] = update(s0, { type: 'nextMonth' })
    expect(s.visibleMonth).toBe(1)
    expect(s.visibleYear).toBe(2025)
  })

  it('moveFocus shifts by days', () => {
    const s0 = init({ value: '2024-06-15' })
    const [s] = update(s0, { type: 'moveFocus', days: 7 })
    expect(s.focused).toBe('2024-06-22')
  })

  it('moveFocus across month boundary syncs visible month', () => {
    const s0 = init({ value: '2024-06-30' })
    const [s] = update(s0, { type: 'moveFocus', days: 1 })
    expect(s.focused).toBe('2024-07-01')
    expect(s.visibleMonth).toBe(7)
  })

  it('selectFocused commits the focused date', () => {
    const s0 = { ...init({ value: '2024-06-15' }), focused: '2024-06-20' }
    const [s] = update(s0, { type: 'selectFocused' })
    expect(s.value).toBe('2024-06-20')
  })

  it('selectFocused respects min/max bounds', () => {
    const s0 = {
      ...init({ value: null, min: '2024-06-10', max: '2024-06-20' }),
      focused: '2024-06-05',
    }
    const [s] = update(s0, { type: 'selectFocused' })
    expect(s.value).toBeNull()
  })

  it('clear removes value', () => {
    const s0 = init({ value: '2024-06-15' })
    const [s] = update(s0, { type: 'clear' })
    expect(s.value).toBeNull()
  })
})

describe('monthGrid', () => {
  it('returns full weeks (multiple of 7)', () => {
    const s = init({ visibleYear: 2024, visibleMonth: 6, weekStartsOn: 0 })
    const cells = monthGrid(s)
    expect(cells.length % 7).toBe(0)
  })

  it('marks in-month days correctly', () => {
    const s = init({ visibleYear: 2024, visibleMonth: 6 })
    const cells = monthGrid(s)
    const inMonth = cells.filter((c) => c.inMonth)
    expect(inMonth.length).toBe(30) // June has 30 days
  })

  it('respects weekStartsOn=1 (Monday)', () => {
    const s = init({ visibleYear: 2024, visibleMonth: 6, weekStartsOn: 1 })
    const cells = monthGrid(s)
    // Expect week starts on Monday — first cell should be a day that produces valid offset
    expect(cells.length % 7).toBe(0)
  })

  it('flags selected date', () => {
    const s = init({ value: '2024-06-15', visibleYear: 2024, visibleMonth: 6 })
    const cells = monthGrid(s)
    const selected = cells.filter((c) => c.isSelected)
    expect(selected).toHaveLength(1)
    expect(selected[0]!.iso).toBe('2024-06-15')
  })

  it('flags disabled dates based on min/max', () => {
    const s = init({ min: '2024-06-10', max: '2024-06-20', visibleYear: 2024, visibleMonth: 6 })
    const cells = monthGrid(s)
    expect(cells.find((c) => c.iso === '2024-06-05')?.isDisabled).toBe(true)
    expect(cells.find((c) => c.iso === '2024-06-15')?.isDisabled).toBe(false)
    expect(cells.find((c) => c.iso === '2024-06-25')?.isDisabled).toBe(true)
  })
})

describe('date-picker.connect', () => {
  const p = connect(rootSignal(), vi.fn())

  it('grid role=grid', () => {
    expect(p.grid().role).toBe('grid')
  })

  it('prevMonthTrigger click sends prevMonth', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.prevMonthTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'prevMonth' })
  })

  it('dayCell ArrowRight sends moveFocus', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const cell = {
      iso: '2024-06-15',
      day: 15,
      inMonth: true,
      isToday: false,
      isSelected: false,
      isFocused: true,
      isDisabled: false,
      isRangeStart: false,
      isRangeEnd: false,
      isInRange: false,
      isUnavailable: false,
    }
    pc.dayCell(cell).cell.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'moveFocus', days: 1 })
  })

  it('dayCell click on disabled day does nothing', () => {
    const send = vi.fn()
    // `signalOf`, not `rootSignal()`: the click handler reads disabled-ness from
    // LIVE state rather than from the cell it was built with, so it peeks. A
    // handler that trusted its build-time snapshot would keep firing on a day
    // that a later `min`/`max` change had disabled.
    const s = init({ min: '2024-06-10', visibleYear: 2024, visibleMonth: 6 })
    const pc = connect(signalOf(s), send)
    const cell = {
      iso: '2024-06-05',
      day: 5,
      inMonth: true,
      isToday: false,
      isSelected: false,
      isFocused: false,
      isDisabled: true,
      isRangeStart: false,
      isRangeEnd: false,
      isInRange: false,
      isUnavailable: false,
    }
    pc.dayCell(cell).cell.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })

  it('dayCell click reads LIVE disabled-ness, not the cell it was handed', () => {
    // The caller's snapshot says enabled; live state (min = the 10th) says the
    // 5th is disabled. A handler trusting its build-time cell would select it.
    const send = vi.fn()
    const s = init({ min: '2024-06-10', visibleYear: 2024, visibleMonth: 6 })
    const bag = connect(signalOf(s), send)
    const stale = rangeCell('2024-06-05')
    expect(stale.isDisabled).toBe(false)
    bag.dayCell(stale).cell.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
    // …and the attribute agrees, from the same source.
    expect(read(bag.dayCell(stale).cell['data-disabled'], s)).toBe('')
  })
})

describe('date-picker range mode', () => {
  it('initializes range state', () => {
    const s = init({ mode: 'range', start: '2024-06-10', end: '2024-06-15' })
    expect(s.mode).toBe('range')
    expect(s.start).toBe('2024-06-10')
    expect(s.end).toBe('2024-06-15')
    expect(s.hoverDate).toBeNull()
  })

  it('first selectFocused sets the anchor (start), clears end', () => {
    const s0 = { ...init({ mode: 'range' }), focused: '2024-06-10' }
    const [s] = update(s0, { type: 'selectFocused' })
    expect(s.start).toBe('2024-06-10')
    expect(s.end).toBeNull()
  })

  it('second selectFocused completes the range', () => {
    let [s] = update(
      { ...init({ mode: 'range' }), focused: '2024-06-10' },
      { type: 'selectFocused' },
    )
    ;[s] = update({ ...s, focused: '2024-06-15' }, { type: 'selectFocused' })
    expect(s.start).toBe('2024-06-10')
    expect(s.end).toBe('2024-06-15')
  })

  it('completing before the anchor swaps start/end', () => {
    let [s] = update(
      { ...init({ mode: 'range' }), focused: '2024-06-15' },
      { type: 'selectFocused' },
    )
    ;[s] = update({ ...s, focused: '2024-06-10' }, { type: 'selectFocused' })
    expect(s.start).toBe('2024-06-10')
    expect(s.end).toBe('2024-06-15')
  })

  it('selecting again after a complete range starts a fresh range', () => {
    const s0 = {
      ...init({ mode: 'range', start: '2024-06-10', end: '2024-06-15' }),
      focused: '2024-06-20',
    }
    const [s] = update(s0, { type: 'selectFocused' })
    expect(s.start).toBe('2024-06-20')
    expect(s.end).toBeNull()
  })

  it('setRange sets both endpoints directly (preset)', () => {
    const [s] = update(init({ mode: 'range' }), {
      type: 'setRange',
      start: '2024-06-01',
      end: '2024-06-30',
    })
    expect(s.start).toBe('2024-06-01')
    expect(s.end).toBe('2024-06-30')
  })

  it('setRange normalizes reversed endpoints', () => {
    const [s] = update(init({ mode: 'range' }), {
      type: 'setRange',
      start: '2024-06-30',
      end: '2024-06-01',
    })
    expect(s.start).toBe('2024-06-01')
    expect(s.end).toBe('2024-06-30')
  })

  it('selectFocused respects min/max in range mode', () => {
    const s0 = {
      ...init({ mode: 'range', min: '2024-06-10', max: '2024-06-20' }),
      focused: '2024-06-05',
    }
    const [s] = update(s0, { type: 'selectFocused' })
    expect(s.start).toBeNull()
  })

  it('setHover / clearHover update the preview anchor', () => {
    const open = { ...init({ mode: 'range' }), start: '2024-06-10', end: null }
    const [hovered] = update(open, { type: 'setHover', date: '2024-06-14' })
    expect(hovered.hoverDate).toBe('2024-06-14')
    const [cleared] = update(hovered, { type: 'clearHover' })
    expect(cleared.hoverDate).toBeNull()
  })
})

describe('monthGrid range flags', () => {
  it('flags range-start, range-end, and in-range cells for a complete range', () => {
    const s = init({
      mode: 'range',
      start: '2024-06-10',
      end: '2024-06-13',
      visibleYear: 2024,
      visibleMonth: 6,
    })
    const cells = monthGrid(s)
    const by = (iso: string) => cells.find((c) => c.iso === iso)!
    expect(by('2024-06-10').isRangeStart).toBe(true)
    expect(by('2024-06-13').isRangeEnd).toBe(true)
    expect(by('2024-06-11').isInRange).toBe(true)
    expect(by('2024-06-12').isInRange).toBe(true)
    expect(by('2024-06-09').isInRange).toBe(false)
    expect(by('2024-06-14').isInRange).toBe(false)
    expect(by('2024-06-10').isSelected).toBe(true)
    expect(by('2024-06-13').isSelected).toBe(true)
    expect(by('2024-06-11').isSelected).toBe(true)
  })

  it('uses hoverDate to preview the range while only the anchor is set', () => {
    const s = init({ mode: 'range', start: '2024-06-10', visibleYear: 2024, visibleMonth: 6 })
    const hovered = { ...s, hoverDate: '2024-06-13' }
    const cells = monthGrid(hovered)
    const by = (iso: string) => cells.find((c) => c.iso === iso)!
    expect(by('2024-06-11').isInRange).toBe(true)
    expect(by('2024-06-12').isInRange).toBe(true)
    expect(by('2024-06-13').isRangeEnd).toBe(true)
  })

  it('previews correctly when hovering before the anchor', () => {
    const s = init({ mode: 'range', start: '2024-06-10', visibleYear: 2024, visibleMonth: 6 })
    const hovered = { ...s, hoverDate: '2024-06-07' }
    const cells = monthGrid(hovered)
    const by = (iso: string) => cells.find((c) => c.iso === iso)!
    expect(by('2024-06-07').isRangeStart).toBe(true)
    expect(by('2024-06-08').isInRange).toBe(true)
    expect(by('2024-06-10').isRangeEnd).toBe(true)
  })
})

describe('monthGrid offset (multi-month)', () => {
  it('offset shifts the rendered month forward', () => {
    const s = init({ visibleYear: 2024, visibleMonth: 6 })
    const cells = monthGrid(s, 1)
    const inMonth = cells.filter((c) => c.inMonth)
    expect(inMonth.length).toBe(31) // July
    expect(inMonth[0]!.iso).toBe('2024-07-01')
  })

  it('offset wraps across the year boundary', () => {
    const s = init({ visibleYear: 2024, visibleMonth: 12 })
    const cells = monthGrid(s, 1)
    const inMonth = cells.filter((c) => c.inMonth)
    expect(inMonth[0]!.iso).toBe('2025-01-01')
  })

  it('offset 0 matches the no-offset grid', () => {
    const s = init({ visibleYear: 2024, visibleMonth: 6 })
    expect(monthGrid(s, 0).map((c) => c.iso)).toEqual(monthGrid(s).map((c) => c.iso))
  })
})

describe('date-picker locale helpers', () => {
  it('monthLabel renders a localized month + year', () => {
    expect(monthLabel(2024, 6, 'en-US')).toMatch(/June 2024/)
    expect(monthLabel(2024, 1, 'fr-FR').toLowerCase()).toContain('janvier')
  })

  it('weekdayLabels returns 7 labels starting on the configured day', () => {
    const sun = weekdayLabels(0, 'en-US')
    expect(sun).toHaveLength(7)
    expect(sun[0]!.toLowerCase()).toContain('s') // Sunday
    const mon = weekdayLabels(1, 'en-US')
    expect(mon).toHaveLength(7)
    expect(mon[0]!.toLowerCase()).toContain('m') // Monday
  })
})

describe('date-picker.connect range + multi-month + presets', () => {
  it('grid(offset) part factory produces a localized aria-label for the offset month', () => {
    const pc = connect(rootSignal(), vi.fn(), { locale: 'en-US' })
    const s = init({ visibleYear: 2024, visibleMonth: 6 })
    const label = read(pc.grid(1)['aria-label'], s)
    expect(label).toMatch(/July 2024/)
  })

  it('preset(range) dispatches a single setRange message', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { mode: 'range' })
    pc.preset({ start: '2024-06-01', end: '2024-06-30' }).onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'setRange',
      start: '2024-06-01',
      end: '2024-06-30',
    })
  })

  it('dayCell range data attributes read the CELL passed in', () => {
    const send = vi.fn()
    const s = init({ mode: 'range', start: '2024-06-10', end: '2024-06-13' })
    const pc = connect(signalOf(s), send, { mode: 'range' })
    const start = pc.dayCell(rangeCell('2024-06-10', { isRangeStart: true, isSelected: true })).cell
    expect(read(start['data-range-start'], s)).toBe('')
    expect(read(start['data-range-end'], s)).toBeUndefined()
    expect(read(start['data-in-range'], s)).toBeUndefined()
    expect(read(start['aria-selected'], s)).toBe(true)
    const mid = pc.dayCell(rangeCell('2024-06-11', { isInRange: true, isSelected: true })).cell
    expect(read(mid['data-in-range'], s)).toBe('')
    const end = pc.dayCell(rangeCell('2024-06-13', { isRangeEnd: true, isSelected: true })).cell
    expect(read(end['data-range-end'], s)).toBe('')
  })

  /**
   * The bag has to be REACTIVE, not a snapshot of the `DayCell` handed in.
   *
   * `view()` runs once, so a plain `cell.isSelected ? '' : undefined` freezes at
   * the value the cell had when the row was built — and a row's identity in a
   * keyed `each` is its date, which selecting a day does not change. Every
   * selection, focus move and range preview was therefore invisible: the state
   * updated, `monthGrid` recomputed, and the DOM kept the flags it was born
   * with. `examples/components-demo` hand-rolls its own cells with
   * `state.map(...)` bindings and never calls `dayCell` — that was the tell.
   *
   * The passed `DayCell` still supplies the cell's IDENTITY (`iso`); the flags
   * are re-derived from live state for that date.
   */
  it('dayCell attributes FOLLOW state, they are not frozen at build time', () => {
    const send = vi.fn()
    // June 2024 must be the VISIBLE month: outside every visible grid `live`
    // falls back to the caller's snapshot, which is the documented behaviour and
    // would make this test pass for the wrong reason.
    const before = init({ mode: 'range', visibleYear: 2024, visibleMonth: 6 })
    const cell = rangeCell('2024-06-10')
    const pc = connect(signalOf(before), send, { mode: 'range' })
    const bag = pc.dayCell(cell).cell
    expect(read(bag['data-selected'], before)).toBeUndefined()
    expect(read(bag['data-range-start'], before)).toBeUndefined()

    // Same bag, later state: the day is now the range start.
    const after = update(before, { type: 'setRange', start: '2024-06-10', end: '2024-06-13' })[0]
    expect(read(bag['data-selected'], after)).toBe('')
    expect(read(bag['data-range-start'], after)).toBe('')
    expect(read(bag['aria-selected'], after)).toBe(true)
  })

  it('dayCell focus and tabindex follow state too', () => {
    const send = vi.fn()
    const before = init({ visibleYear: 2024, visibleMonth: 6 })
    const bag = connect(signalOf(before), send).dayCell(rangeCell('2024-06-10')).cell
    expect(read(bag['tabindex'], before)).toBe(-1)
    const after = update(before, { type: 'setFocused', date: '2024-06-10' })[0]
    expect(read(bag['data-focused'], after)).toBe('')
    expect(read(bag['tabindex'], after)).toBe(0)
  })

  it('dayCell hover sends setHover in range mode', () => {
    const send = vi.fn()
    const s = init({ mode: 'range', visibleYear: 2024, visibleMonth: 6 })
    const pc = connect(signalOf(s), send, { mode: 'range' })
    pc.dayCell(rangeCell('2024-06-12')).cell.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).toHaveBeenCalledWith({ type: 'setHover', date: '2024-06-12' })
  })

  it('keyboard focus crosses month boundaries (date-addressed)', () => {
    const s0 = init({ value: '2024-06-30', mode: 'single' })
    const [s] = update(s0, { type: 'moveFocus', days: 1 })
    expect(s.focused).toBe('2024-07-01')
    expect(s.visibleMonth).toBe(7)
  })
})

// #266: "today" came from the wall clock at every grid computation, so a
// gallery screenshot, an SSR render and its hydration could disagree about
// which cell is today (and a test's today-marker moved every midnight). It is
// now PINNABLE state, and a helper computes it in any IANA time zone.
describe('date-picker pinned today and time zones (#266)', () => {
  it('a pinned today drives the today marker, the default focus and the visible month', () => {
    const s = init({ today: '2026-03-14' })
    expect(s.today).toBe('2026-03-14')
    expect(s.focused).toBe('2026-03-14')
    expect([s.visibleYear, s.visibleMonth]).toEqual([2026, 3])
    const todayCells = monthGrid(s).filter((c) => c.isToday)
    expect(todayCells.map((c) => c.iso)).toEqual(['2026-03-14'])
  })

  it('focusToday honours the pinned today, not the clock', () => {
    const s0 = init({ today: '2026-03-14', value: '2025-01-02' })
    const [s] = update(s0, { type: 'focusToday' })
    expect(s.focused).toBe('2026-03-14')
    expect(s.visibleMonth).toBe(3)
  })

  it('setToday re-pins (and null returns to the clock)', () => {
    const s0 = init({ today: '2026-03-14' })
    expect(update(s0, { type: 'setToday', today: '2026-03-15' })[0].today).toBe('2026-03-15')
    expect(update(s0, { type: 'setToday', today: null })[0].today).toBeNull()
  })

  it('todayInTimeZone reads the calendar date of an instant in a named zone', () => {
    // 2026-03-14T23:30:00Z: still the 14th in Los Angeles, already the 15th in Auckland.
    const instant = Date.UTC(2026, 2, 14, 23, 30)
    expect(todayInTimeZone('America/Los_Angeles', instant)).toBe('2026-03-14')
    expect(todayInTimeZone('Pacific/Auckland', instant)).toBe('2026-03-15')
    expect(todayInTimeZone('UTC', instant)).toBe('2026-03-14')
  })

  it('the state stays a JSON round-trip identity with a pinned today', () => {
    const s = init({ today: '2026-03-14', unavailable: ['2026-03-20'] })
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

// #266: bookings, holidays and sold-out dates are not a min/max window. A date
// in `unavailable` is disabled like an out-of-bounds one, but published
// separately so a skin can strike it through rather than merely dim it.
describe('date-picker unavailable dates (#266)', () => {
  const base = {
    today: '2026-03-14',
    visibleYear: 2026,
    visibleMonth: 3,
    unavailable: ['2026-03-18', '2026-03-19'],
  }

  it('marks unavailable cells disabled AND unavailable; bounds stay merely disabled', () => {
    const s = init({ ...base, min: '2026-03-05' })
    const byIso = new Map(monthGrid(s).map((c) => [c.iso, c]))
    expect(byIso.get('2026-03-18')).toMatchObject({ isDisabled: true, isUnavailable: true })
    expect(byIso.get('2026-03-02')).toMatchObject({ isDisabled: true, isUnavailable: false })
    expect(byIso.get('2026-03-17')).toMatchObject({ isDisabled: false, isUnavailable: false })
  })

  it('selectFocused refuses an unavailable date', () => {
    const s0 = init(base)
    const focused = update(s0, { type: 'setFocused', date: '2026-03-18' })[0]
    expect(update(focused, { type: 'selectFocused' })[0].value).toBeNull()
  })

  it('a range may not be completed across an unavailable date', () => {
    const s0 = init({ ...base, mode: 'range' })
    const anchored = update(update(s0, { type: 'setFocused', date: '2026-03-16' })[0], {
      type: 'selectFocused',
    })[0]
    expect(anchored.start).toBe('2026-03-16')
    const across = update(update(anchored, { type: 'setFocused', date: '2026-03-21' })[0], {
      type: 'selectFocused',
    })[0]
    expect(across.end).toBeNull()
    expect(across.start).toBe('2026-03-16')
    const within = update(update(anchored, { type: 'setFocused', date: '2026-03-17' })[0], {
      type: 'selectFocused',
    })[0]
    expect([within.start, within.end]).toEqual(['2026-03-16', '2026-03-17'])
  })

  it('setUnavailable replaces the set', () => {
    const s = update(init(base), { type: 'setUnavailable', dates: ['2026-03-01'] })[0]
    expect(s.unavailable).toEqual(['2026-03-01'])
  })

  it('the day cell publishes data-unavailable', () => {
    const s = init(base)
    const bag = connect(signalOf(s), vi.fn()).dayCell(rangeCell('2026-03-18')).cell
    expect(read(bag['data-unavailable'], s)).toBe('')
    expect(read(bag['aria-disabled'], s)).toBe('true')
    const free = connect(signalOf(s), vi.fn()).dayCell(rangeCell('2026-03-17')).cell
    expect(read(free['data-unavailable'], s)).toBeUndefined()
  })

  it('range hover preview reads disabled-ness LIVE, not from the build-time cell', () => {
    const s = init({ ...base, mode: 'range' })
    const send = vi.fn()
    // The caller's snapshot says "enabled"; live state says unavailable.
    const bag = connect(signalOf(s), send, { mode: 'range' }).dayCell(rangeCell('2026-03-18')).cell
    bag.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).not.toHaveBeenCalled()
  })
})

// #266: PageUp/PageDown changed the visible month but left the roving focus in
// the PREVIOUS month, so the new grid had no tabindex=0 cell and keyboard focus
// had nowhere to land. They now move the focused date by a month (clamping the
// day), which brings the visible month along with it.
describe('date-picker month paging keeps the roving focus visible (#266)', () => {
  it('moveFocusMonths moves by calendar months and clamps the day', () => {
    const s0 = init({ value: '2026-01-31' })
    const [feb] = update(s0, { type: 'moveFocusMonths', months: 1 })
    expect(feb.focused).toBe('2026-02-28')
    expect([feb.visibleYear, feb.visibleMonth]).toEqual([2026, 2])
    const [dec] = update(s0, { type: 'moveFocusMonths', months: -1 })
    expect(dec.focused).toBe('2025-12-31')
    expect([dec.visibleYear, dec.visibleMonth]).toEqual([2025, 12])
  })

  it('PageDown / PageUp send moveFocusMonths and the focused cell stays in the grid', () => {
    const send = vi.fn()
    const s = init({ value: '2026-03-14' })
    const bag = connect(signalOf(s), send).dayCell(rangeCell('2026-03-14')).cell
    const down = new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true })
    Object.defineProperty(down, 'currentTarget', { value: document.body })
    bag.onKeyDown(down)
    expect(send).toHaveBeenLastCalledWith({ type: 'moveFocusMonths', months: 1 })
    const up = new KeyboardEvent('keydown', { key: 'PageUp', cancelable: true })
    Object.defineProperty(up, 'currentTarget', { value: document.body })
    bag.onKeyDown(up)
    expect(send).toHaveBeenLastCalledWith({ type: 'moveFocusMonths', months: -1 })
    const next = update(s, { type: 'moveFocusMonths', months: 1 })[0]
    expect(monthGrid(next).some((c) => c.isFocused && c.inMonth)).toBe(true)
  })
})
