import { resolveLocaleSlice, type Locale } from './context.js'

export const enNavigationMenu: Locale['navigationMenu'] = { label: 'Main navigation' }
export const navigationMenuLocale = (): Locale['navigationMenu'] =>
  resolveLocaleSlice('navigationMenu', enNavigationMenu)
