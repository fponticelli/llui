import { cached, cacheKey } from './cache.js'
import { defaultLocale } from './defaults.js'

export type RelativeTimeUnit =
  | 'year'
  | 'quarter'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'

export interface FormatRelativeTimeOptions {
  locale?: string
  numeric?: 'always' | 'auto'
  style?: 'long' | 'short' | 'narrow'
}

export function formatRelativeTime(
  value: number,
  unit: RelativeTimeUnit,
  opts: FormatRelativeTimeOptions = {},
): string {
  const locale = opts.locale ?? defaultLocale()
  const intlOpts: Intl.RelativeTimeFormatOptions = {
    numeric: opts.numeric ?? 'auto',
    style: opts.style ?? 'long',
  }
  const key = cacheKey('rel', locale, intlOpts as Record<string, unknown>)
  const fmt = cached(key, () => new Intl.RelativeTimeFormat(locale, intlOpts))
  return fmt.format(value, unit)
}
