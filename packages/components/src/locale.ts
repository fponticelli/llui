import { createContext } from '@llui/dom'

/** Per-component locale strings. Only components with user-facing text have entries. */
export interface Locale {
  carousel: {
    label: string
    indicators: string
    next: string
    prev: string
    slide: (index: number) => string
    goToSlide: (index: number) => string
  }
  cascadeSelect: { clear: string }
  clipboard: { copy: string }
  colorPicker: { hue: string; saturation: string; lightness: string; hex: string }
  combobox: { toggle: string }
  dateInput: { clear: string }
  datePicker: {
    prev: string
    next: string
    monthNames: string[]
    grid: (year: number, month: number) => string
  }
  dialog: { close: string }
  drawer: { close: string }
  fileUpload: { remove: string; clear: string }
  floatingPanel: { label: string; minimize: string; maximize: string; close: string }
  imageCropper: { reset: string }
  navigationMenu: { label: string }
  numberInput: { increment: string; decrement: string }
  pagination: { label: string; prev: string; next: string; page: (n: number) => string }
  passwordInput: { show: string; hide: string }
  pinInput: { input: (index: number) => string }
  popover: { close: string }
  progress: { loading: string }
  qrCode: { label: string; download: string }
  signaturePad: { label: string; clear: string; undo: string }
  steps: { label: string }
  tagsInput: { input: string; remove: string; clear: string }
  timePicker: { label: string; hours: string; minutes: string; period: string }
  timer: { start: string; pause: string; reset: string }
  toast: { region: string; dismiss: string }
  toc: { label: string; expand: string }
  tour: { close: string }
}

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

/** English locale — used as the default when no provider is in the tree. */
export const en: Locale = {
  carousel: {
    label: 'Carousel',
    indicators: 'Slide indicators',
    next: 'Next slide',
    prev: 'Previous slide',
    slide: (i) => `Slide ${i + 1}`,
    goToSlide: (i) => `Go to slide ${i + 1}`,
  },
  cascadeSelect: { clear: 'Clear selection' },
  clipboard: { copy: 'Copy to clipboard' },
  colorPicker: { hue: 'Hue', saturation: 'Saturation', lightness: 'Lightness', hex: 'Hex color' },
  combobox: { toggle: 'Toggle options' },
  dateInput: { clear: 'Clear date' },
  datePicker: {
    prev: 'Previous month',
    next: 'Next month',
    monthNames: MONTH_NAMES,
    grid: (y, m) => `${MONTH_NAMES[m - 1]} ${y}`,
  },
  dialog: { close: 'Close' },
  drawer: { close: 'Close' },
  fileUpload: { remove: 'Remove file', clear: 'Clear files' },
  floatingPanel: { label: 'Floating panel', minimize: 'Minimize', maximize: 'Maximize', close: 'Close' },
  imageCropper: { reset: 'Reset crop' },
  navigationMenu: { label: 'Main navigation' },
  numberInput: { increment: 'Increase value', decrement: 'Decrease value' },
  pagination: { label: 'Pagination', prev: 'Previous page', next: 'Next page', page: (n) => `Page ${n}` },
  passwordInput: { show: 'Show password', hide: 'Hide password' },
  pinInput: { input: (i) => `Digit ${i + 1}` },
  popover: { close: 'Close' },
  progress: { loading: 'Loading\u2026' },
  qrCode: { label: 'QR code', download: 'Download QR code' },
  signaturePad: { label: 'Signature pad', clear: 'Clear signature', undo: 'Undo last stroke' },
  steps: { label: 'Progress' },
  tagsInput: { input: 'Add tag', remove: 'Remove tag', clear: 'Clear all tags' },
  timePicker: { label: 'Time', hours: 'Hours', minutes: 'Minutes', period: 'Toggle AM/PM' },
  timer: { start: 'Start timer', pause: 'Pause timer', reset: 'Reset timer' },
  toast: { region: 'Notifications', dismiss: 'Dismiss notification' },
  toc: { label: 'Table of contents', expand: 'Toggle section' },
  tour: { close: 'Close tour' },
}

/**
 * Locale context. Components read from this via `useContext(LocaleContext)`.
 * English defaults are provided — apps that don't call `provide()` get English for free.
 */
export const LocaleContext = createContext<Locale>(en)

