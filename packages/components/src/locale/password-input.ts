import { resolveLocaleSlice, type Locale } from './context.js'

export const enPasswordInput: Locale['passwordInput'] = {
  show: 'Show password',
  hide: 'Hide password',
}
export const passwordInputLocale = (): Locale['passwordInput'] =>
  resolveLocaleSlice('passwordInput', enPasswordInput)
