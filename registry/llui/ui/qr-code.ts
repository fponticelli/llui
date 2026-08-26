import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * QR code — skin for `@llui/components/qr-code`. No shadcn counterpart.
 *
 * The `background` and `foreground` parts are SVG elements the machine fills
 * with the module grid, and they are deliberately left to `fill-*` utilities
 * rather than given theme colours here: a QR code needs real contrast to scan,
 * and a themed pair that passes a contrast check for text can still fail a
 * scanner. `fill-white`/`fill-black` are the safe default; override at the call
 * site if the surrounding surface demands it, and test with a real scanner.
 */
export const QrCode = classPart(div, 'inline-flex flex-col items-center gap-2')
export const QrCodeSvg = classPart(div, 'size-32 rounded-md border bg-white p-2')
export const QrCodeBackground = classPart(div, 'fill-white')
export const QrCodeForeground = classPart(div, 'fill-black')
export const QrCodeDownloadTrigger = classPart(
  button,
  buttonVariants({ variant: 'outline', size: 'sm' }),
)
