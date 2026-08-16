import { resolveLocaleSlice, type Locale } from './context.js'

export const enProgress: Locale['progress'] = { loading: 'Loading\u2026' }
export const progressLocale = (): Locale['progress'] => resolveLocaleSlice('progress', enProgress)
