import { resolveLocaleSlice, type Locale } from './context.js'

export const enFileUpload: Locale['fileUpload'] = { remove: 'Remove file', clear: 'Clear files' }
export const fileUploadLocale = (): Locale['fileUpload'] =>
  resolveLocaleSlice('fileUpload', enFileUpload)
