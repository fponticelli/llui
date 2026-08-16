import { resolveLocaleSlice, type Locale } from './context.js'

export const enClipboard: Locale['clipboard'] = { copy: 'Copy to clipboard' }
export const clipboardLocale = (): Locale['clipboard'] =>
  resolveLocaleSlice('clipboard', enClipboard)
