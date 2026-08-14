import { cached, cacheKey } from './cache.js'
import { defaultLocale } from './defaults.js'
import { parseDateValue } from '../utils/date.js'
import type { DateValue } from '../utils/date.js'

export type { DateValue }

type DateStyle = 'full' | 'long' | 'medium' | 'short'

export interface FormatDateOptions {
  locale?: string
  dateStyle?: DateStyle
  calendar?: string
  numberingSystem?: string
  timeZone?: string
  weekday?: 'long' | 'short' | 'narrow'
  year?: 'numeric' | '2-digit'
  month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow'
  day?: 'numeric' | '2-digit'
  era?: 'long' | 'short' | 'narrow'
}

export interface FormatTimeOptions {
  locale?: string
  timeStyle?: DateStyle
  timeZone?: string
  hour12?: boolean
  hourCycle?: 'h11' | 'h12' | 'h23' | 'h24'
  hour?: 'numeric' | '2-digit'
  minute?: 'numeric' | '2-digit'
  second?: 'numeric' | '2-digit'
  fractionalSecondDigits?: 0 | 1 | 2 | 3
  timeZoneName?: 'long' | 'short' | 'shortOffset' | 'longOffset' | 'shortGeneric' | 'longGeneric'
  dayPeriod?: 'narrow' | 'short' | 'long'
}

export interface FormatDateTimeOptions {
  locale?: string
  dateStyle?: DateStyle
  timeStyle?: DateStyle
  timeZone?: string
  calendar?: string
  hour12?: boolean
  hourCycle?: 'h11' | 'h12' | 'h23' | 'h24'
}

function buildIntlOpts(opts: object): Intl.DateTimeFormatOptions {
  const result: Intl.DateTimeFormatOptions = {}
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined && k !== 'locale') {
      ;(result as Record<string, unknown>)[k] = v
    }
  }
  return result
}

function fmt(
  prefix: string,
  locale: string,
  intlOpts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = cacheKey(prefix, locale, intlOpts as unknown as Record<string, unknown>)
  return cached(key, () => new Intl.DateTimeFormat(locale, intlOpts))
}

/**
 * Zone override for a date-only value. A bare '2026-01-15' is a CALENDAR date:
 * it names no instant, so it carries no zone and `timeZone` does not apply to
 * it. `parseDateValue` anchors it at UTC midnight, so rendering it in UTC is
 * what keeps the printed day equal to the written one everywhere — reading it
 * in the ambient zone printed 14 January west of UTC (#125).
 */
function zoneFor(dateOnly: boolean, opts: object): object {
  return dateOnly ? { ...opts, timeZone: 'UTC' } : opts
}

export function formatDate(value: DateValue, opts: FormatDateOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const { date, dateOnly } = parseDateValue(value)
  const base = zoneFor(dateOnly, opts)
  const hasFineGrained = opts.weekday || opts.year || opts.month || opts.day || opts.era
  const intlOpts = hasFineGrained
    ? buildIntlOpts(base)
    : buildIntlOpts({ ...base, dateStyle: opts.dateStyle ?? 'medium' })
  return fmt('date', locale, intlOpts).format(date)
}

export function formatTime(value: DateValue, opts: FormatTimeOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const { date, dateOnly } = parseDateValue(value)
  const base = zoneFor(dateOnly, opts)
  const hasFineGrained =
    opts.hour || opts.minute || opts.second || opts.fractionalSecondDigits || opts.dayPeriod
  const intlOpts = hasFineGrained
    ? buildIntlOpts(base)
    : buildIntlOpts({ ...base, timeStyle: opts.timeStyle ?? 'medium' })
  return fmt('time', locale, intlOpts).format(date)
}

export function formatDateTime(value: DateValue, opts: FormatDateTimeOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const { date, dateOnly } = parseDateValue(value)
  const intlOpts = buildIntlOpts({
    ...zoneFor(dateOnly, opts),
    dateStyle: opts.dateStyle ?? 'medium',
    timeStyle: opts.timeStyle ?? 'short',
  })
  return fmt('dt', locale, intlOpts).format(date)
}
