import { resolveLocaleSlice, type Locale } from './context.js'

export const enCombobox: Locale['combobox'] = {
  toggle: 'Toggle options',
  resultCount: (n) => (n === 1 ? '1 result' : `${n} results`),
}
export const comboboxLocale = (): Locale['combobox'] => resolveLocaleSlice('combobox', enCombobox)
