import { resolveLocaleSlice, type Locale } from './context.js'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const enDatePicker: Locale['datePicker'] = {
  prev: 'Previous month',
  next: 'Next month',
  monthNames: MONTH_NAMES,
  grid: (year, month) => `${MONTH_NAMES[month - 1]} ${year}`,
}
export const datePickerLocale = (): Locale['datePicker'] =>
  resolveLocaleSlice('datePicker', enDatePicker)
