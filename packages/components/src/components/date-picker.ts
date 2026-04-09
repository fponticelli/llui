import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext, en } from '../locale'
import type { Locale } from '../locale'

/**
 * Date picker — calendar with month navigation and date selection. Works
 * with plain Date objects internally but exposes ISO strings (YYYY-MM-DD)
 * for serialization-friendly state.
 *
 * Keyboard navigation: arrow keys move by day, PageUp/Down by month,
 * Home/End to start/end of week, Enter to select.
 */

export interface DatePickerState {
  /** Selected date as YYYY-MM-DD, or null. */
  value: string | null
  /** The month currently visible (1-indexed, 1-12). */
  visibleMonth: number
  /** The year currently visible. */
  visibleYear: number
  /** The date currently focused by the keyboard (YYYY-MM-DD). */
  focused: string
  /** Minimum selectable date, inclusive. */
  min: string | null
  /** Maximum selectable date, inclusive. */
  max: string | null
  /** 0=Sunday, 1=Monday. */
  weekStartsOn: 0 | 1
  disabled: boolean
}

export type DatePickerMsg =
  | { type: 'setValue'; value: string | null }
  | { type: 'setFocused'; date: string }
  | { type: 'prevMonth' }
  | { type: 'nextMonth' }
  | { type: 'prevYear' }
  | { type: 'nextYear' }
  | { type: 'selectFocused' }
  | { type: 'moveFocus'; days: number }
  | { type: 'focusStartOfWeek' }
  | { type: 'focusEndOfWeek' }
  | { type: 'focusToday' }
  | { type: 'clear' }

export interface DatePickerInit {
  value?: string | null
  visibleMonth?: number
  visibleYear?: number
  min?: string | null
  max?: string | null
  weekStartsOn?: 0 | 1
  disabled?: boolean
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function todayIso(): string {
  const now = new Date()
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function addDays(iso: string, days: number): string {
  const p = parseIso(iso)
  if (!p) return iso
  const d = new Date(p.y, p.m - 1, p.d)
  d.setDate(d.getDate() + days)
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function isInRange(iso: string, min: string | null, max: string | null): boolean {
  if (min && iso < min) return false
  if (max && iso > max) return false
  return true
}

export function init(opts: DatePickerInit = {}): DatePickerState {
  const today = todayIso()
  const parsed = opts.value ? parseIso(opts.value) : null
  const visibleMonth = opts.visibleMonth ?? parsed?.m ?? new Date().getMonth() + 1
  const visibleYear = opts.visibleYear ?? parsed?.y ?? new Date().getFullYear()
  return {
    value: opts.value ?? null,
    visibleMonth,
    visibleYear,
    focused: opts.value ?? today,
    min: opts.min ?? null,
    max: opts.max ?? null,
    weekStartsOn: opts.weekStartsOn ?? 0,
    disabled: opts.disabled ?? false,
  }
}

function normalizeMonth(year: number, month: number): { year: number; month: number } {
  let y = year
  let m = month
  while (m > 12) {
    m -= 12
    y += 1
  }
  while (m < 1) {
    m += 12
    y -= 1
  }
  return { year: y, month: m }
}

function syncVisibleMonth(state: DatePickerState, date: string): DatePickerState {
  const p = parseIso(date)
  if (!p) return state
  if (p.y === state.visibleYear && p.m === state.visibleMonth) return state
  return { ...state, visibleYear: p.y, visibleMonth: p.m }
}

export function update(state: DatePickerState, msg: DatePickerMsg): [DatePickerState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value, focused: msg.value ?? state.focused }, []]
    case 'setFocused':
      return [syncVisibleMonth({ ...state, focused: msg.date }, msg.date), []]
    case 'prevMonth': {
      const n = normalizeMonth(state.visibleYear, state.visibleMonth - 1)
      return [{ ...state, visibleYear: n.year, visibleMonth: n.month }, []]
    }
    case 'nextMonth': {
      const n = normalizeMonth(state.visibleYear, state.visibleMonth + 1)
      return [{ ...state, visibleYear: n.year, visibleMonth: n.month }, []]
    }
    case 'prevYear':
      return [{ ...state, visibleYear: state.visibleYear - 1 }, []]
    case 'nextYear':
      return [{ ...state, visibleYear: state.visibleYear + 1 }, []]
    case 'selectFocused':
      if (!isInRange(state.focused, state.min, state.max)) return [state, []]
      return [{ ...state, value: state.focused }, []]
    case 'moveFocus': {
      const next = addDays(state.focused, msg.days)
      return [syncVisibleMonth({ ...state, focused: next }, next), []]
    }
    case 'focusStartOfWeek': {
      const p = parseIso(state.focused)
      if (!p) return [state, []]
      const d = new Date(p.y, p.m - 1, p.d)
      const delta = (d.getDay() - state.weekStartsOn + 7) % 7
      return [update(state, { type: 'moveFocus', days: -delta })[0], []]
    }
    case 'focusEndOfWeek': {
      const p = parseIso(state.focused)
      if (!p) return [state, []]
      const d = new Date(p.y, p.m - 1, p.d)
      const delta = 6 - ((d.getDay() - state.weekStartsOn + 7) % 7)
      return [update(state, { type: 'moveFocus', days: delta })[0], []]
    }
    case 'focusToday': {
      const today = todayIso()
      return [syncVisibleMonth({ ...state, focused: today }, today), []]
    }
    case 'clear':
      return [{ ...state, value: null }, []]
  }
}

export interface DayCell {
  iso: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  isFocused: boolean
  isDisabled: boolean
}

/**
 * Compute the grid of days visible in the current month view. Always returns
 * full weeks: leading days from previous month and trailing from next month
 * to fill the grid.
 */
export function monthGrid(state: DatePickerState): DayCell[] {
  const y = state.visibleYear
  const m = state.visibleMonth
  const first = new Date(y, m - 1, 1)
  const firstDay = first.getDay()
  const leadDays = (firstDay - state.weekStartsOn + 7) % 7
  const totalDays = daysInMonth(y, m)
  const today = todayIso()

  const cells: DayCell[] = []
  // Leading: previous month's trailing days
  for (let i = leadDays; i > 0; i--) {
    const d = new Date(y, m - 1, 1 - i)
    const iso = toIso(d.getFullYear(), d.getMonth() + 1, d.getDate())
    cells.push({
      iso,
      day: d.getDate(),
      inMonth: false,
      isToday: iso === today,
      isSelected: iso === state.value,
      isFocused: iso === state.focused,
      isDisabled: !isInRange(iso, state.min, state.max),
    })
  }
  // Current month
  for (let d = 1; d <= totalDays; d++) {
    const iso = toIso(y, m, d)
    cells.push({
      iso,
      day: d,
      inMonth: true,
      isToday: iso === today,
      isSelected: iso === state.value,
      isFocused: iso === state.focused,
      isDisabled: !isInRange(iso, state.min, state.max),
    })
  }
  // Trailing: next month's leading days to fill to multiple of 7
  const remaining = (7 - (cells.length % 7)) % 7
  for (let d = 1; d <= remaining; d++) {
    const next = new Date(y, m, d)
    const iso = toIso(next.getFullYear(), next.getMonth() + 1, next.getDate())
    cells.push({
      iso,
      day: d,
      inMonth: false,
      isToday: iso === today,
      isSelected: iso === state.value,
      isFocused: iso === state.focused,
      isDisabled: !isInRange(iso, state.min, state.max),
    })
  }
  return cells
}

export interface DayCellParts<_S> {
  cell: {
    role: 'gridcell'
    'aria-selected': boolean
    'aria-disabled': 'true' | undefined
    tabIndex: number
    'data-scope': 'date-picker'
    'data-part': 'day-cell'
    'data-date': string
    'data-in-month': '' | undefined
    'data-today': '' | undefined
    'data-selected': '' | undefined
    'data-focused': '' | undefined
    'data-disabled': '' | undefined
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
}

export interface DatePickerParts<S> {
  root: {
    'data-scope': 'date-picker'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
  }
  grid: {
    role: 'grid'
    'aria-label': (s: S) => string
    'data-scope': 'date-picker'
    'data-part': 'grid'
  }
  prevMonthTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'date-picker'
    'data-part': 'prev-month-trigger'
    onClick: (e: MouseEvent) => void
  }
  nextMonthTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'date-picker'
    'data-part': 'next-month-trigger'
    onClick: (e: MouseEvent) => void
  }
  dayCell: (cell: DayCell) => DayCellParts<S>
}

export interface ConnectOptions {
  prevLabel?: string
  nextLabel?: string
  gridLabel?: (year: number, month: number) => string
}

export function connect<S>(
  get: (s: S) => DatePickerState,
  send: Send<DatePickerMsg>,
  opts: ConnectOptions = {},
): DatePickerParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const prevLabel: string | ((s: S) => string) =
    opts.prevLabel ?? ((s: S) => locale(s).datePicker.prev)
  const nextLabel: string | ((s: S) => string) =
    opts.nextLabel ?? ((s: S) => locale(s).datePicker.next)
  const gridLabel = opts.gridLabel ?? en.datePicker.grid

  return {
    root: {
      'data-scope': 'date-picker',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    grid: {
      role: 'grid',
      'aria-label': (s) => gridLabel(get(s).visibleYear, get(s).visibleMonth),
      'data-scope': 'date-picker',
      'data-part': 'grid',
    },
    prevMonthTrigger: {
      type: 'button',
      'aria-label': prevLabel,
      disabled: (s) => get(s).disabled,
      'data-scope': 'date-picker',
      'data-part': 'prev-month-trigger',
      onClick: () => send({ type: 'prevMonth' }),
    },
    nextMonthTrigger: {
      type: 'button',
      'aria-label': nextLabel,
      disabled: (s) => get(s).disabled,
      'data-scope': 'date-picker',
      'data-part': 'next-month-trigger',
      onClick: () => send({ type: 'nextMonth' }),
    },
    dayCell: (cell: DayCell): DayCellParts<S> => ({
      cell: {
        role: 'gridcell',
        'aria-selected': cell.isSelected,
        'aria-disabled': cell.isDisabled ? 'true' : undefined,
        tabIndex: cell.isFocused ? 0 : -1,
        'data-scope': 'date-picker',
        'data-part': 'day-cell',
        'data-date': cell.iso,
        'data-in-month': cell.inMonth ? '' : undefined,
        'data-today': cell.isToday ? '' : undefined,
        'data-selected': cell.isSelected ? '' : undefined,
        'data-focused': cell.isFocused ? '' : undefined,
        'data-disabled': cell.isDisabled ? '' : undefined,
        onClick: () => {
          if (cell.isDisabled) return
          send({ type: 'setFocused', date: cell.iso })
          send({ type: 'selectFocused' })
        },
        onFocus: () => send({ type: 'setFocused', date: cell.iso }),
        onKeyDown: (e) => {
          switch (e.key) {
            case 'ArrowLeft':
              e.preventDefault()
              send({ type: 'moveFocus', days: -1 })
              return
            case 'ArrowRight':
              e.preventDefault()
              send({ type: 'moveFocus', days: 1 })
              return
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'moveFocus', days: -7 })
              return
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'moveFocus', days: 7 })
              return
            case 'PageUp':
              e.preventDefault()
              send({ type: 'prevMonth' })
              return
            case 'PageDown':
              e.preventDefault()
              send({ type: 'nextMonth' })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'focusStartOfWeek' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'focusEndOfWeek' })
              return
            case 'Enter':
            case ' ':
              e.preventDefault()
              send({ type: 'selectFocused' })
              return
          }
        },
      },
    }),
  }
}

export const datePicker = { init, update, connect, monthGrid }
