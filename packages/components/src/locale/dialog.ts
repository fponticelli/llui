import { resolveLocaleSlice, type Locale } from './context.js'

export const enDialog: Locale['dialog'] = { close: 'Close' }
export const dialogLocale = (): Locale['dialog'] => resolveLocaleSlice('dialog', enDialog)
