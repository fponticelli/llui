import { resolveLocaleSlice, type Locale } from './context.js'

export const enDrawer: Locale['drawer'] = { close: 'Close' }
export const drawerLocale = (): Locale['drawer'] => resolveLocaleSlice('drawer', enDrawer)
