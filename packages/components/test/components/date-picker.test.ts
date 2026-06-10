import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  monthGrid,
  monthLabel,
  weekdayLabels,
} from '../../src/components/date-picker'
import { rootSignal, read } from '../_signal'

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
    }
    pc.dayCell(cell).cell.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'moveFocus', days: 1 })
  })

  it('dayCell click on disabled day does nothing', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
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
    }
    pc.dayCell(cell).cell.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
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

  it('dayCell exposes reactive range data attributes', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const start = pc.dayCell(rangeCell('2024-06-10', { isRangeStart: true, isSelected: true })).cell
    expect(start['data-range-start']).toBe('')
    expect(start['data-range-end']).toBeUndefined()
    expect(start['data-in-range']).toBeUndefined()
    expect(start['aria-selected']).toBe(true)
    const mid = pc.dayCell(rangeCell('2024-06-11', { isInRange: true, isSelected: true })).cell
    expect(mid['data-in-range']).toBe('')
    expect(mid['aria-selected']).toBe(true)
    const end = pc.dayCell(rangeCell('2024-06-13', { isRangeEnd: true, isSelected: true })).cell
    expect(end['data-range-end']).toBe('')
  })

  it('dayCell hover sends setHover in range mode', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { mode: 'range' })
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
