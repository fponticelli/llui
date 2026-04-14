import { cached, cacheKey } from './cache.js'
import { defaultLocale } from './defaults.js'

export interface FormatListOptions {
  locale?: string
  type?: 'conjunction' | 'disjunction' | 'unit'
  style?: 'long' | 'short' | 'narrow'
}

export function formatList(value: string[], opts: FormatListOptions = {}): string {
  const locale = opts.locale ?? defaultLocale()
  const intlOpts: Intl.ListFormatOptions = {
    type: opts.type ?? 'conjunction',
    style: opts.style ?? 'long',
  }
  const key = cacheKey('list', locale, intlOpts as Record<string, unknown>)
  const fmt = cached(key, () => new Intl.ListFormat(locale, intlOpts))
  return fmt.format(value)
}
