import { button, div, path, rect, svg } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * QR code — skin for `@llui/components/qr-code`. No shadcn counterpart.
 *
 * The three graphic parts are REAL SVG elements: spread `svg` onto `QrCodeSvg`
 * (the `<svg>`), `background` onto `QrCodeBackground` (a `<rect>` the machine
 * sizes to the module grid) and `foreground` onto `QrCodeForeground` (the
 * `<path>` holding every dark module). These used to be `div`s, which put the
 * parts in the HTML namespace — `fill-*` never applied and nothing drew (#266).
 *
 * The plate and module colours are deliberately NOT theme tokens: a QR code
 * needs real contrast to scan, and a token pair that passes a text-contrast
 * check can still defeat a scanner. `bg-white` / `fill-white` / `fill-black`
 * hold in dark mode, and `forced-color-adjust-none` holds them under forced
 * colors too. Override at the call site only with a scanner in hand.
 *
 * `data-empty` on the root (no matrix yet) turns the plate into an obviously
 * empty dashed slot rather than a blank tile that reads as a failed render.
 */
export const QrCode = classPart(div, 'group/qr-code inline-flex flex-col items-center gap-2')
export const QrCodeSvg = classPart(
  svg,
  'block size-32 rounded-md border bg-white p-2 forced-color-adjust-none group-data-empty/qr-code:border-dashed group-data-empty/qr-code:bg-muted',
)
export const QrCodeBackground = classPart(
  rect,
  'fill-white group-data-empty/qr-code:fill-transparent',
)
export const QrCodeForeground = classPart(path, 'fill-black')
export const QrCodeDownloadTrigger = classPart(
  button,
  buttonVariants({ variant: 'outline', size: 'sm' }),
)
