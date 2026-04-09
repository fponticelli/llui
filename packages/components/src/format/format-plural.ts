import { cached, cacheKey } from './cache'
import { defaultLocale } from './defaults'

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
export type PluralMessages = Partial<Record<PluralCategory, string>> & { other: string }

export interface FormatPluralOptions {
  locale?: string
  type?: 'cardinal' | 'ordinal'
  minimumIntegerDigits?: number
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  minimumSignificantDigits?: number
  maximumSignificantDigits?: number
}

export function resolvePluralCategory(
  value: number,
  opts: FormatPluralOptions = {},
): PluralCategory {
  const locale = opts.locale ?? defaultLocale()
  const intlOpts: Intl.PluralRulesOptions = { type: opts.type ?? 'cardinal' }
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

  const key = cacheKey('plural', locale, intlOpts as Record<string, unknown>)
  const rules = cached(key, () => new Intl.PluralRules(locale, intlOpts))
  return rules.select(value) as PluralCategory
}

export function formatPlural(
  value: number,
  messages: PluralMessages,
  opts: FormatPluralOptions = {},
): string {
  // Check for explicit zero/one/two messages before CLDR rules
  // (English PluralRules returns 'other' for 0, but apps may want a 'zero' message)
  if (value === 0 && messages.zero !== undefined) return messages.zero
  const category = resolvePluralCategory(value, opts)
  const template = messages[category] ?? messages.other
  const locale = opts.locale ?? defaultLocale()
  const formatted = new Intl.NumberFormat(locale).format(value)
  return template.replace(/\{count\}/g, formatted)
}
