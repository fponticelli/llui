import { resolveLocaleSlice, type Locale } from './context.js'

export const enTimer: Locale['timer'] = {
  start: 'Start timer',
  pause: 'Pause timer',
  reset: 'Reset timer',
}
export const timerLocale = (): Locale['timer'] => resolveLocaleSlice('timer', enTimer)
