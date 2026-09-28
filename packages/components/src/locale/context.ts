import { createContext, useContext } from '@llui/dom'
import type { TextDirection } from '../utils/direction.js'

/** Per-component locale strings. Only components with user-facing text have entries. */
export interface Locale {
  /**
   * App-wide reading direction. When unset, components fall back to their own
   * `dir` option or DOM resolution; an explicit component direction wins.
   */
  direction?: TextDirection
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
  colorPicker: {
    hue: string
    saturation: string
    lightness: string
    value: string
    chroma: string
    oklchLightness: string
    hex: string
    alpha: string
    eyeDropper: string
    switchToOklch: string
    switchToHsv: string
    swatchGroup: string
  }
  combobox: { toggle: string; resultCount: (n: number) => string }
  dateInput: { clear: string }
  datePicker: {
    prev: string
    next: string
    monthNames: string[]
    grid: (year: number, month: number) => string
  }
  dialog: { close: string }
  drawer: { close: string }
  fileUpload: { remove: string; clear: string; retry: string; progress: string }
  floatingPanel: {
    label: string
    minimize: string
    maximize: string
    close: string
    move: string
    resize: string
  }
  gradientPicker: {
    track: string
    stop: (index: number, count: number, color: string, position: number) => string
    addStop: string
    removeStop: string
    linear: string
    radial: string
    conic: string
    repeating: string
    angle: string
    center: string
    shapeCircle: string
    shapeEllipse: string
    sizeClosestSide: string
    sizeClosestCorner: string
    sizeFarthestSide: string
    sizeFarthestCorner: string
    interpolationSpace: string
    interpolationHue: string
    reverse: string
    distribute: string
    css: string
    cssError: (reason: string) => string
  }
  imageCropper: { reset: string; cropArea: string }
  navigationMenu: { label: string }
  numberInput: { increment: string; decrement: string }
  pagination: { label: string; prev: string; next: string; page: (n: number) => string }
  passwordInput: { show: string; hide: string }
  pinInput: { input: (index: number) => string }
  popover: { close: string }
  progress: { loading: string }
  qrCode: { label: string; download: string }
  signaturePad: { label: string; clear: string; undo: string }
  sortable: { handle: string }
  /** The composed accessible name of a sparkline. `from`/`to` arrive as
   *  `YYYY-MM-DD` in the sparkline's own calendar offset. */
  sparkline: { empty: string; range: (count: number, from: string, to: string) => string }
  steps: { label: string }
  /** Accessible names of the table's selection checkboxes (#268). */
  table: { selectAll: string; selectRow: string }
  tagsInput: { input: string; remove: string; clear: string }
  timePicker: { label: string; hours: string; minutes: string; period: string }
  timer: { start: string; pause: string; reset: string }
  toast: { region: string; dismiss: string }
  toc: { label: string; expand: string }
  tour: { close: string }
}

/**
 * Component entry points use this lightweight context so their default locale
 * can live beside the component instead of importing the aggregate `en` object.
 * The public LocaleContext has the same id, so providers remain interoperable.
 */
export const ComponentLocaleContext = createContext<Locale | undefined>(undefined, 'LocaleContext')

export function resolveLocaleSlice<K extends keyof Locale>(key: K, fallback: Locale[K]): Locale[K] {
  return useContext(ComponentLocaleContext)?.[key] ?? fallback
}
