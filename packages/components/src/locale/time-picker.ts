import { resolveLocaleSlice, type Locale } from './context.js'

export const enTimePicker: Locale['timePicker'] = {
  label: 'Time',
  hours: 'Hours',
  minutes: 'Minutes',
  period: 'Toggle AM/PM',
}
export const timePickerLocale = (): Locale['timePicker'] =>
  resolveLocaleSlice('timePicker', enTimePicker)
