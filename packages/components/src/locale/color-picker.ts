import { resolveLocaleSlice, type Locale } from './context.js'

export const enColorPicker: Locale['colorPicker'] = {
  hue: 'Hue',
  saturation: 'Saturation',
  lightness: 'Lightness',
  hex: 'Hex color',
}
export const colorPickerLocale = (): Locale['colorPicker'] =>
  resolveLocaleSlice('colorPicker', enColorPicker)
