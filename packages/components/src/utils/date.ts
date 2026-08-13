/**
 * Date-only handling — the ONE place that decides whether a value denotes an
 * INSTANT or a bare CALENDAR DATE.
 *
 * `new Date('2026-01-15')` parses a date-only string as UTC midnight (ES spec),
 * so formatting it against the ambient zone renders the PREVIOUS day everywhere
 * west of UTC: `formatDate('2026-01-15')` printed "January 14, 2026" under
 * America/New_York and the right answer under Europe/Rome, which is why it
 * survived (#125 defect 4).
 *
 * A calendar date carries no instant and therefore no zone, so it is anchored
 * at UTC midnight and its consumers must render it in UTC — see `dateOnly`.
 */

export type DateValue = Date | string | number

/** `YYYY-MM-DD` and nothing else: any time part makes the value an instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export interface ParsedDateValue {
  date: Date
  /**
   * True when the input was a bare calendar date. Formatters MUST then render
   * in UTC (where the anchor was taken), otherwise the ambient zone shifts the
   * rendered day.
   */
  dateOnly: boolean
}

export function isDateOnly(value: DateValue): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value)
}

export function parseDateValue(value: DateValue): ParsedDateValue {
  if (isDateOnly(value)) {
    // `${value}T00:00:00Z` and `new Date(value)` agree today, but spelling the
    // anchor out keeps it independent of the bare-string parsing rule.
    return { date: new Date(`${value}T00:00:00Z`), dateOnly: true }
  }
  if (value instanceof Date) return { date: value, dateOnly: false }
  return { date: new Date(value), dateOnly: false }
}
