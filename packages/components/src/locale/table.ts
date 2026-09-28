import { resolveLocaleSlice, type Locale } from './context.js'

export const enTable: Locale['table'] = { selectAll: 'Select all rows', selectRow: 'Select row' }
export const tableLocale = (): Locale['table'] => resolveLocaleSlice('table', enTable)
