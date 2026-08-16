import { resolveLocaleSlice, type Locale } from './context.js'

export const enCascadeSelect: Locale['cascadeSelect'] = { clear: 'Clear selection' }
export const cascadeSelectLocale = (): Locale['cascadeSelect'] =>
  resolveLocaleSlice('cascadeSelect', enCascadeSelect)
