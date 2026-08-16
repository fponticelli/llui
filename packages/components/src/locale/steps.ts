import { resolveLocaleSlice, type Locale } from './context.js'

export const enSteps: Locale['steps'] = { label: 'Progress' }
export const stepsLocale = (): Locale['steps'] => resolveLocaleSlice('steps', enSteps)
