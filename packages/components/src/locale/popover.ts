import { resolveLocaleSlice, type Locale } from './context.js'

export const enPopover: Locale['popover'] = { close: 'Close' }
export const popoverLocale = (): Locale['popover'] => resolveLocaleSlice('popover', enPopover)
