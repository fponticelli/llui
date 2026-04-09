import { cached, cacheKey } from './cache'
import { defaultLocale } from './defaults'

const DEFAULT_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export interface FormatFileSizeOptions {
  locale?: string
  units?: string[]
  decimalPlaces?: number
}

export function formatFileSize(
  value: number | bigint,
  opts: FormatFileSizeOptions = {},
): string {
  const locale = opts.locale ?? defaultLocale()
  const units = opts.units ?? DEFAULT_UNITS
  const decimals = opts.decimalPlaces ?? 1

  let num = typeof value === 'bigint' ? Number(value) : value
  let unitIndex = 0
  while (num >= 1024 && unitIndex < units.length - 1) {
    num /= 1024
    unitIndex++
  }

  const fractionDigits = unitIndex === 0 ? 0 : decimals
  const intlOpts: Intl.NumberFormatOptions = {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }
  const key = cacheKey('fs', locale, intlOpts as Record<string, unknown>)
  const fmt = cached(key, () => new Intl.NumberFormat(locale, intlOpts))
  const formatted = fmt.format(num)

  // Strip trailing zeros when using default decimal places
  const display =
    opts.decimalPlaces === undefined && unitIndex > 0
      ? formatted.replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '')
      : formatted

  return `${display} ${units[unitIndex]}`
}
