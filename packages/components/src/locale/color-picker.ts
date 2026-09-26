import { resolveLocaleSlice, type Locale } from './context.js'

export const enColorPicker: Locale['colorPicker'] = {
  hue: 'Hue',
  saturation: 'Saturation',
  lightness: 'Lightness',
  value: 'Value',
  chroma: 'Chroma',
  oklchLightness: 'Lightness',
  hex: 'Hex color',
  eyeDropper: 'Pick color from screen',
  switchToOklch: 'Switch to OKLCH',
  switchToHsv: 'Switch to HSV',
}
export const colorPickerLocale = (): Locale['colorPicker'] =>
  resolveLocaleSlice('colorPicker', enColorPicker)
