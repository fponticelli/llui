import { resolveLocaleSlice, type Locale } from './context.js'

export const enToast: Locale['toast'] = {
  region: 'Notifications',
  dismiss: 'Dismiss notification',
}
export const toastLocale = (): Locale['toast'] => resolveLocaleSlice('toast', enToast)
