import { resolveLocaleSlice, type Locale } from './context.js'

export const enTour: Locale['tour'] = { close: 'Close tour' }
export const tourLocale = (): Locale['tour'] => resolveLocaleSlice('tour', enTour)
