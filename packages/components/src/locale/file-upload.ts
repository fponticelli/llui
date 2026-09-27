import { resolveLocaleSlice, type Locale } from './context.js'

export const enFileUpload: Locale['fileUpload'] = {
  remove: 'Remove file',
  clear: 'Clear files',
  retry: 'Retry upload',
  progress: 'Upload progress',
}
export const fileUploadLocale = (): Locale['fileUpload'] =>
  resolveLocaleSlice('fileUpload', enFileUpload)
