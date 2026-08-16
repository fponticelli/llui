import { resolveLocaleSlice, type Locale } from './context.js'

export const enSignaturePad: Locale['signaturePad'] = {
  label: 'Signature pad',
  clear: 'Clear signature',
  undo: 'Undo last stroke',
}
export const signaturePadLocale = (): Locale['signaturePad'] =>
  resolveLocaleSlice('signaturePad', enSignaturePad)
