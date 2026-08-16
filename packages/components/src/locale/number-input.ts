import { resolveLocaleSlice, type Locale } from './context.js'

export const enNumberInput: Locale['numberInput'] = {
  increment: 'Increase value',
  decrement: 'Decrease value',
}
export const numberInputLocale = (): Locale['numberInput'] =>
  resolveLocaleSlice('numberInput', enNumberInput)
