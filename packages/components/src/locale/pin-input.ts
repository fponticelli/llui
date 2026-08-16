import { resolveLocaleSlice, type Locale } from './context.js'

export const enPinInput: Locale['pinInput'] = { input: (index) => `Digit ${index + 1}` }
export const pinInputLocale = (): Locale['pinInput'] => resolveLocaleSlice('pinInput', enPinInput)
