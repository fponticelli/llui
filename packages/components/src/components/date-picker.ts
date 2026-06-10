import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { LocaleContext } from '../locale.js'
import { formatDate } from '../format/format-date.js'
import { defaultLocale } from '../format/defaults.js'

/**
 * Date picker — calendar with month navigation and date selection. Works
 * with plain Date objects internally but exposes ISO strings (YYYY-MM-DD)
 * for serialization-friendly state.
 *
 * Supports single-date (`mode: 'single'`, default) and range (`mode: 'range'`)
 * selection, a multi-month view (`months`), preset ranges, and locale-aware
 * month/weekday rendering via `@llui/components`' Intl wrappers.
 *
 * Keyboard navigation: arrow keys move by day, PageUp/Down by month,
 * Home/End to start/end of week, Enter to select. Because cells are
 * date-addressed, keyboard focus crosses month (and year) boundaries.
 */

/** Selection mode: a single date or a start/end range. */
export type DatePickerMode = 'single' | 'range'

export interface DatePickerState {
  /** Selection mode. Defaults to 'single'. */
  mode: DatePickerMode
  /** Selected date as YYYY-MM-DD, or null. Used in 'single' mode. */
  value: string | null
  /** Range start as YYYY-MM-DD, or null. Used in 'range' mode. */
  start: string | null
  /** Range end as YYYY-MM-DD, or null. Used in 'range' mode. */
  end: string | null
  /** Date currently hovered/previewed while a range is being completed. */
  hoverDate: string | null
  /** The month currently visible (1-indexed, 1-12) — the first/leftmost month. */
  visibleMonth: number
  /** The year currently visible. */
  visibleYear: number
  /** Number of months rendered side-by-side. Defaults to 1. */
  months: number
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
  /** @intent("Set the selected date (YYYY-MM-DD), or null to clear") */
  | { type: 'setValue'; value: string | null }
  /** @intent("Set the selected date range (YYYY-MM-DD start/end); endpoints are normalized so start <= end") */
  | { type: 'setRange'; start: string | null; end: string | null }
  /** @humanOnly */
  | { type: 'setFocused'; date: string }
  /** @humanOnly */
  | { type: 'setHover'; date: string }
  /** @humanOnly */
  | { type: 'clearHover' }
  /** @intent("Show the previous month in the calendar") */
  | { type: 'prevMonth' }
  /** @intent("Show the next month in the calendar") */
  | { type: 'nextMonth' }
  /** @intent("Show the previous year (same month)") */
  | { type: 'prevYear' }
  /** @intent("Show the next year (same month)") */
  | { type: 'nextYear' }
  /** @intent("Select the currently-focused date (anchors or completes a range in range mode)") */
  | { type: 'selectFocused' }
  /** @humanOnly */
  | { type: 'moveFocus'; days: number }
  /** @humanOnly */
  | { type: 'focusStartOfWeek' }
  /** @humanOnly */
  | { type: 'focusEndOfWeek' }
  /** @humanOnly */
  | { type: 'focusToday' }
  /** @intent("Clear the current selection") */
  | { type: 'clear' }

export interface DatePickerInit {
  mode?: DatePickerMode
  value?: string | null
  start?: string | null
  end?: string | null
  visibleMonth?: number
  visibleYear?: number
  months?: number
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

function withinBounds(iso: string, min: string | null, max: string | null): boolean {
  if (min && iso < min) return false
  if (max && iso > max) return false
  return true
}

/**
 * Resolve the locale's first day of the week (0=Sunday … 6=Saturday), narrowed
 * to the `0 | 1` the grid math supports (Sunday-start vs Monday-start). Uses
 * `Intl.Locale#getWeekInfo()` where available; falls back to Sunday.
 */
function localeWeekStart(locale: string): 0 | 1 {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo
    // Intl reports Monday=1 … Sunday=7. Map to our 0=Sunday / 1=Monday scheme.
    if (info && info.firstDay === 7) return 0
    if (info && info.firstDay === 1) return 1
  } catch {
    // Older runtimes: no Intl.Locale weekInfo support.
  }
  return 0
}

/**
 * Localized "Month YYYY" label for a calendar header, backed by
 * `Intl.DateTimeFormat` via the package's `formatDate` wrapper.
 */
export function monthLabel(year: number, month: number, locale?: string): string {
  return formatDate(new Date(year, month - 1, 1), {
    locale: locale ?? defaultLocale(),
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Localized weekday header labels (length 7), rotated so the array begins on
 * `weekStartsOn` (0=Sunday, 1=Monday). Uses a known reference week so the Intl
 * formatter yields the correct day names.
 */
export function weekdayLabels(weekStartsOn: 0 | 1, locale?: string): string[] {
  const loc = locale ?? defaultLocale()
  // 2024-01-07 is a Sunday — anchor the reference week there.
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    const dow = (weekStartsOn + i) % 7
    labels.push(formatDate(new Date(2024, 0, 7 + dow), { locale: loc, weekday: 'short' }))
  }
  return labels
}

export function init(opts: DatePickerInit = {}): DatePickerState {
  const today = todayIso()
  const mode = opts.mode ?? 'single'
  const anchorIso = opts.value ?? opts.start ?? null
  const parsed = anchorIso ? parseIso(anchorIso) : null
  const visibleMonth = opts.visibleMonth ?? parsed?.m ?? new Date().getMonth() + 1
  const visibleYear = opts.visibleYear ?? parsed?.y ?? new Date().getFullYear()
  const weekStartsOn = opts.weekStartsOn ?? localeWeekStart(defaultLocale())
  return {
    mode,
    value: opts.value ?? null,
    start: opts.start ?? null,
    end: opts.end ?? null,
    hoverDate: null,
    visibleMonth,
    visibleYear,
    months: opts.months ?? 1,
    focused: anchorIso ?? today,
    min: opts.min ?? null,
    max: opts.max ?? null,
    weekStartsOn,
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

function normalizeRange(
  a: string | null,
  b: string | null,
): { start: string | null; end: string | null } {
  if (a && b) return a <= b ? { start: a, end: b } : { start: b, end: a }
  return { start: a, end: b }
}

export function update(state: DatePickerState, msg: DatePickerMsg): [DatePickerState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value, focused: msg.value ?? state.focused }, []]
    case 'setRange': {
      const norm = normalizeRange(msg.start, msg.end)
      const next = norm.start ?? norm.end
      return [
        {
          ...state,
          start: norm.start,
          end: norm.end,
          hoverDate: null,
          focused: next ?? state.focused,
        },
        [],
      ]
    }
    case 'setFocused':
      return [syncVisibleMonth({ ...state, focused: msg.date }, msg.date), []]
    case 'setHover':
      return [{ ...state, hoverDate: msg.date }, []]
    case 'clearHover':
      return [{ ...state, hoverDate: null }, []]
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
    case 'selectFocused': {
      if (!withinBounds(state.focused, state.min, state.max)) return [state, []]
      if (state.mode === 'range') {
        // No anchor yet, or a complete range already exists → start fresh.
        if (state.start === null || state.end !== null) {
          return [{ ...state, start: state.focused, end: null, hoverDate: null }, []]
        }
        // Anchor set, no end → complete the range (swap if before the anchor).
        const norm = normalizeRange(state.start, state.focused)
        return [{ ...state, start: norm.start, end: norm.end, hoverDate: null }, []]
      }
      return [{ ...state, value: state.focused }, []]
    }
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
      return [{ ...state, value: null, start: null, end: null, hoverDate: null }, []]
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
  /** True for the start endpoint of a (committed or previewed) range. */
  isRangeStart: boolean
  /** True for the end endpoint of a (committed or previewed) range. */
  isRangeEnd: boolean
  /** True for dates strictly between the range endpoints. */
  isInRange: boolean
}

/**
 * Resolve the effective range endpoints for a given state, including the live
 * hover preview when an anchor is set but the range is not yet complete.
 */
function effectiveRange(state: DatePickerState): { start: string | null; end: string | null } {
  if (state.mode !== 'range') return { start: null, end: null }
  if (state.start !== null && state.end !== null) {
    return { start: state.start, end: state.end }
  }
  if (state.start !== null && state.hoverDate !== null) {
    return normalizeRange(state.start, state.hoverDate)
  }
  return { start: state.start, end: state.end }
}

function makeCell(
  iso: string,
  day: number,
  inMonth: boolean,
  state: DatePickerState,
  today: string,
  range: { start: string | null; end: string | null },
): DayCell {
  const isRangeStart = range.start !== null && iso === range.start
  const isRangeEnd = range.end !== null && iso === range.end
  const isInRange =
    range.start !== null && range.end !== null && iso > range.start && iso < range.end
  const isSelected =
    state.mode === 'range' ? isRangeStart || isRangeEnd || isInRange : iso === state.value
  return {
    iso,
    day,
    inMonth,
    isToday: iso === today,
    isSelected,
    isFocused: iso === state.focused,
    isDisabled: !withinBounds(iso, state.min, state.max),
    isRangeStart,
    isRangeEnd,
    isInRange,
  }
}

/**
 * Compute the grid of days for a visible month. Always returns full weeks:
 * leading days from the previous month and trailing from the next month fill
 * the grid. `offset` shifts the rendered month forward by N months from the
 * state's `visibleMonth`/`visibleYear` (used by the multi-month view).
 */
export function monthGrid(state: DatePickerState, offset = 0): DayCell[] {
  const norm = normalizeMonth(state.visibleYear, state.visibleMonth + offset)
  const y = norm.year
  const m = norm.month
  const first = new Date(y, m - 1, 1)
  const firstDay = first.getDay()
  const leadDays = (firstDay - state.weekStartsOn + 7) % 7
  const totalDays = daysInMonth(y, m)
  const today = todayIso()
  const range = effectiveRange(state)

  const cells: DayCell[] = []
  // Leading: previous month's trailing days
  for (let i = leadDays; i > 0; i--) {
    const d = new Date(y, m - 1, 1 - i)
    const iso = toIso(d.getFullYear(), d.getMonth() + 1, d.getDate())
    cells.push(makeCell(iso, d.getDate(), false, state, today, range))
  }
  // Current month
  for (let d = 1; d <= totalDays; d++) {
    cells.push(makeCell(toIso(y, m, d), d, true, state, today, range))
  }
  // Trailing: next month's leading days to fill to multiple of 7
  const remaining = (7 - (cells.length % 7)) % 7
  for (let d = 1; d <= remaining; d++) {
    const next = new Date(y, m, d)
    const iso = toIso(next.getFullYear(), next.getMonth() + 1, next.getDate())
    cells.push(makeCell(iso, d, false, state, today, range))
  }
  return cells
}

/**
 * Group a flat `DayCell[]` (from `monthGrid`) into rows of 7 — one row
 * per week — so the view can wrap each in a `role="row"` element as
 * required by the WAI-ARIA grid pattern.
 */
export function weekRows(cells: DayCell[]): DayCell[][] {
  const rows: DayCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7))
  }
  return rows
}

export interface DayCellParts {
  cell: {
    role: 'gridcell'
    'aria-selected': boolean
    'aria-disabled': 'true' | undefined
    tabindex: number
    'data-scope': 'date-picker'
    'data-part': 'day-cell'
    'data-date': string
    'data-in-month': '' | undefined
    'data-today': '' | undefined
    'data-selected': '' | undefined
    'data-focused': '' | undefined
    'data-disabled': '' | undefined
    'data-range-start': '' | undefined
    'data-range-end': '' | undefined
    'data-in-range': '' | undefined
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
    onPointerEnter: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
  }
}

/** A named preset range a consumer can render as a quick-select button. */
export interface PresetRange {
  start: string | null
  end: string | null
}

export interface PresetParts {
  type: 'button'
  'data-scope': 'date-picker'
  'data-part': 'preset'
  onClick: (e: MouseEvent) => void
}

export interface DatePickerParts {
  root: {
    'data-scope': 'date-picker'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  /**
   * Grid part factory. `offset` (default 0) selects which month this grid
   * renders in a multi-month view — the `aria-label` is the localized
   * "Month YYYY" of `visibleMonth + offset`.
   */
  grid: (offset?: number) => {
    role: 'grid'
    'aria-label': Signal<string>
    'data-scope': 'date-picker'
    'data-part': 'grid'
    'data-month-offset': number
  }
  row: {
    role: 'row'
    'data-scope': 'date-picker'
    'data-part': 'row'
  }
  prevMonthTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'date-picker'
    'data-part': 'prev-month-trigger'
    onClick: (e: MouseEvent) => void
  }
  nextMonthTrigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'date-picker'
    'data-part': 'next-month-trigger'
    onClick: (e: MouseEvent) => void
  }
  dayCell: (cell: DayCell) => DayCellParts
  /** Preset part factory — clicking dispatches a single `setRange`. */
  preset: (range: PresetRange) => PresetParts
}

export interface ConnectOptions {
  /** Selection mode — affects pointer-hover preview wiring. Defaults to 'single'. */
  mode?: DatePickerMode
  /** BCP-47 locale tag for month/grid labels. Defaults to the runtime default. */
  locale?: string
  prevLabel?: string
  nextLabel?: string
  gridLabel?: (year: number, month: number) => string
}

export function connect(
  state: Signal<DatePickerState>,
  send: Send<DatePickerMsg>,
  opts: ConnectOptions = {},
): DatePickerParts {
  const localeStrings = useContext(LocaleContext)
  const prevLabel = opts.prevLabel ?? localeStrings.datePicker.prev
  const nextLabel = opts.nextLabel ?? localeStrings.datePicker.next
  const localeTag = opts.locale ?? defaultLocale()
  const gridLabel = opts.gridLabel ?? ((y: number, m: number) => monthLabel(y, m, localeTag))
  const isRange = opts.mode === 'range'

  return {
    root: {
      'data-scope': 'date-picker',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    grid: (offset = 0) => ({
      role: 'grid',
      'aria-label': state.map((s) => {
        const n = normalizeMonth(s.visibleYear, s.visibleMonth + offset)
        return gridLabel(n.year, n.month)
      }),
      'data-scope': 'date-picker',
      'data-part': 'grid',
      'data-month-offset': offset,
    }),
    row: {
      role: 'row',
      'data-scope': 'date-picker',
      'data-part': 'row',
    },
    prevMonthTrigger: {
      type: 'button',
      'aria-label': prevLabel,
      disabled: state.map((s) => s.disabled),
      'data-scope': 'date-picker',
      'data-part': 'prev-month-trigger',
      onClick: tagSend(send, ['prevMonth'], () => send({ type: 'prevMonth' })),
    },
    nextMonthTrigger: {
      type: 'button',
      'aria-label': nextLabel,
      disabled: state.map((s) => s.disabled),
      'data-scope': 'date-picker',
      'data-part': 'next-month-trigger',
      onClick: tagSend(send, ['nextMonth'], () => send({ type: 'nextMonth' })),
    },
    dayCell: (cell: DayCell): DayCellParts => ({
      cell: {
        role: 'gridcell',
        'aria-selected': cell.isSelected,
        'aria-disabled': cell.isDisabled ? 'true' : undefined,
        tabindex: cell.isFocused ? 0 : -1,
        'data-scope': 'date-picker',
        'data-part': 'day-cell',
        'data-date': cell.iso,
        'data-in-month': cell.inMonth ? '' : undefined,
        'data-today': cell.isToday ? '' : undefined,
        'data-selected': cell.isSelected ? '' : undefined,
        'data-focused': cell.isFocused ? '' : undefined,
        'data-disabled': cell.isDisabled ? '' : undefined,
        'data-range-start': cell.isRangeStart ? '' : undefined,
        'data-range-end': cell.isRangeEnd ? '' : undefined,
        'data-in-range': cell.isInRange ? '' : undefined,
        onClick: tagSend(send, ['setFocused', 'selectFocused'], () => {
          if (cell.isDisabled) return
          send({ type: 'setFocused', date: cell.iso })
          send({ type: 'selectFocused' })
        }),
        onFocus: tagSend(send, ['setFocused'], () => send({ type: 'setFocused', date: cell.iso })),
        onKeyDown: tagSend(
          send,
          [
            'moveFocus',
            'prevMonth',
            'nextMonth',
            'focusStartOfWeek',
            'focusEndOfWeek',
            'selectFocused',
          ],
          (e) => {
            const key = flipArrow(e.key, e.currentTarget as Element)
            switch (key) {
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
        ),
        onPointerEnter: tagSend(send, ['setHover'], () => {
          if (!isRange || cell.isDisabled) return
          send({ type: 'setHover', date: cell.iso })
        }),
        onPointerLeave: tagSend(send, ['clearHover'], () => {
          if (!isRange) return
          send({ type: 'clearHover' })
        }),
      },
    }),
    preset: (range: PresetRange): PresetParts => ({
      type: 'button',
      'data-scope': 'date-picker',
      'data-part': 'preset',
      onClick: tagSend(send, ['setRange'], () =>
        send({ type: 'setRange', start: range.start, end: range.end }),
      ),
    }),
  }
}

export const datePicker = {
  init,
  update,
  connect,
  monthGrid,
  weekRows,
  monthLabel,
  weekdayLabels,
}
