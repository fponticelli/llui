import { cached, cacheKey } from './cache'
import { defaultLocale } from './defaults'

export type DateValue = Date | string | number

function toDate(value: DateValue): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  return new Date(value)
}

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

export function formatDate(value: DateValue, opts: FormatDateOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const hasFineGrained = opts.weekday || opts.year || opts.month || opts.day || opts.era
  const intlOpts = hasFineGrained
    ? buildIntlOpts(opts)
    : buildIntlOpts({ ...opts, dateStyle: opts.dateStyle ?? 'medium' })
  return fmt('date', locale, intlOpts).format(toDate(value))
}

export function formatTime(value: DateValue, opts: FormatTimeOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const hasFineGrained =
    opts.hour || opts.minute || opts.second || opts.fractionalSecondDigits || opts.dayPeriod
  const intlOpts = hasFineGrained
    ? buildIntlOpts(opts)
    : buildIntlOpts({ ...opts, timeStyle: opts.timeStyle ?? 'medium' })
  return fmt('time', locale, intlOpts).format(toDate(value))
}

export function formatDateTime(value: DateValue, opts: FormatDateTimeOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const intlOpts = buildIntlOpts({
    ...opts,
    dateStyle: opts.dateStyle ?? 'medium',
    timeStyle: opts.timeStyle ?? 'short',
  })
  return fmt('dt', locale, intlOpts).format(toDate(value))
}
