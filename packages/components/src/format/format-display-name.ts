import { cached, cacheKey } from './cache.js'
import { defaultLocale } from './defaults.js'

export type DisplayNameType =
  | 'language'
  | 'region'
  | 'script'
  | 'currency'
  | 'calendar'
  | 'dateTimeField'

export interface FormatDisplayNameOptions {
  locale?: string
  style?: 'long' | 'short' | 'narrow'
  languageDisplay?: 'dialect' | 'standard'
  fallback?: 'code' | 'none'
}

export function formatDisplayName(
  value: string,
  type: DisplayNameType,
  opts: FormatDisplayNameOptions = {},
): string | undefined {
  const locale = opts.locale ?? defaultLocale()
  const intlOpts: Intl.DisplayNamesOptions = {
    type,
    style: opts.style ?? 'long',
    fallback: opts.fallback ?? 'code',
  }
  if (opts.languageDisplay !== undefined && type === 'language') {
    intlOpts.languageDisplay = opts.languageDisplay
  }
  const key = cacheKey('dn', locale, { ...intlOpts } as Record<string, unknown>)
  const dn = cached(key, () => new Intl.DisplayNames(locale, intlOpts))
  try {
    return dn.of(value)
  } catch {
    return opts.fallback === 'none' ? undefined : value
  }
}
