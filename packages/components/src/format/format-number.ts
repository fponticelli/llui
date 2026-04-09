import { cached, cacheKey } from './cache'
import { defaultLocale } from './defaults'

export interface FormatNumberOptions {
  locale?: string
  style?: 'decimal' | 'currency' | 'percent' | 'unit'
  currency?: string
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name'
  signDisplay?: 'auto' | 'never' | 'always' | 'exceptZero'
  notation?: 'standard' | 'scientific' | 'engineering' | 'compact'
  compactDisplay?: 'short' | 'long'
  unit?: string
  unitDisplay?: 'short' | 'long' | 'narrow'
  useGrouping?: boolean
  minimumIntegerDigits?: number
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  minimumSignificantDigits?: number
  maximumSignificantDigits?: number
}

export function formatNumber(value: number, opts: FormatNumberOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const intlOpts: Intl.NumberFormatOptions = {}
  if (opts.style !== undefined) intlOpts.style = opts.style
  if (opts.currency !== undefined) intlOpts.currency = opts.currency
  if (opts.currencyDisplay !== undefined) intlOpts.currencyDisplay = opts.currencyDisplay
  if (opts.signDisplay !== undefined) intlOpts.signDisplay = opts.signDisplay
  if (opts.notation !== undefined) intlOpts.notation = opts.notation
  if (opts.compactDisplay !== undefined) intlOpts.compactDisplay = opts.compactDisplay
  if (opts.unit !== undefined) intlOpts.unit = opts.unit
  if (opts.unitDisplay !== undefined) intlOpts.unitDisplay = opts.unitDisplay
  if (opts.useGrouping !== undefined) intlOpts.useGrouping = opts.useGrouping
  if (opts.minimumIntegerDigits !== undefined)
    intlOpts.minimumIntegerDigits = opts.minimumIntegerDigits
  if (opts.minimumFractionDigits !== undefined)
    intlOpts.minimumFractionDigits = opts.minimumFractionDigits
  if (opts.maximumFractionDigits !== undefined)
    intlOpts.maximumFractionDigits = opts.maximumFractionDigits
  if (opts.minimumSignificantDigits !== undefined)
    intlOpts.minimumSignificantDigits = opts.minimumSignificantDigits
  if (opts.maximumSignificantDigits !== undefined)
    intlOpts.maximumSignificantDigits = opts.maximumSignificantDigits

  const key = cacheKey('num', locale, intlOpts as Record<string, unknown>)
  const fmt = cached(key, () => new Intl.NumberFormat(locale, intlOpts))
  return fmt.format(value)
}
