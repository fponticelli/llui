import { resolveLocaleSlice, type Locale } from './context.js'

export const enQrCode: Locale['qrCode'] = { label: 'QR code', download: 'Download QR code' }
export const qrCodeLocale = (): Locale['qrCode'] => resolveLocaleSlice('qrCode', enQrCode)
