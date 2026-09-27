import { resolveLocaleSlice, type Locale } from './context.js'

export const enImageCropper: Locale['imageCropper'] = { reset: 'Reset crop', cropArea: 'Crop area' }
export const imageCropperLocale = (): Locale['imageCropper'] =>
  resolveLocaleSlice('imageCropper', enImageCropper)
