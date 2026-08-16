import { resolveLocaleSlice, type Locale } from './context.js'

export const enDateInput: Locale['dateInput'] = { clear: 'Clear date' }
export const dateInputLocale = (): Locale['dateInput'] =>
  resolveLocaleSlice('dateInput', enDateInput)
