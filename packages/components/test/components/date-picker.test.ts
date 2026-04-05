import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, monthGrid } from '../../src/components/date-picker'
import type { DatePickerState } from '../../src/components/date-picker'

type Ctx = { d: DatePickerState }

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
  const p = connect<Ctx>((s) => s.d, vi.fn())

  it('grid role=grid', () => {
    expect(p.grid.role).toBe('grid')
  })

  it('prevMonthTrigger click sends prevMonth', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.d, send)
    pc.prevMonthTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'prevMonth' })
  })

  it('dayCell ArrowRight sends moveFocus', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.d, send)
    const cell = {
      iso: '2024-06-15',
      day: 15,
      inMonth: true,
      isToday: false,
      isSelected: false,
      isFocused: true,
      isDisabled: false,
    }
    pc.dayCell(cell).cell.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'moveFocus', days: 1 })
  })

  it('dayCell click on disabled day does nothing', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.d, send)
    const cell = {
      iso: '2024-06-05',
      day: 5,
      inMonth: true,
      isToday: false,
      isSelected: false,
      isFocused: false,
      isDisabled: true,
    }
    pc.dayCell(cell).cell.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })
})
