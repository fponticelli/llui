import { resolveLocaleSlice, type Locale } from './context.js'

export const enImageCropper: Locale['imageCropper'] = { reset: 'Reset crop' }
export const imageCropperLocale = (): Locale['imageCropper'] =>
  resolveLocaleSlice('imageCropper', enImageCropper)
