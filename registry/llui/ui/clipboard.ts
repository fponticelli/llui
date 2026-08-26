import { button, div, input, span } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { inputRecipe } from '@/ui/input'

/**
 * Clipboard — skin for `@llui/components/clipboard`. No shadcn counterpart.
 *
 * `indicator` is an `aria-live` region, so it stays MOUNTED and swaps its text;
 * `data-copied` is the styling hook. Toggling it with `show` would unmount the
 * live region and announce nothing — the same trap the Combobox live region
 * documents.
 */
export const Clipboard = classPart(div, 'relative flex w-full max-w-sm items-center')
export const ClipboardInput = classPart(input, `${inputRecipe} pr-9 font-mono`)
export const ClipboardTrigger = classPart(
  button,
  "absolute top-0 right-0 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-copied:text-primary [&_svg:not([class*='size-'])]:size-4",
)
export const ClipboardIndicator = classPart(span, 'sr-only')
