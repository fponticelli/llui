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
 *
 * A REFUSED write (`copyFailed`: permission denied, insecure context) publishes
 * `data-failed` (#266). The indicator is then SHOWN as well as announced, in
 * destructive text on its own line, so a sighted user learns the copy did not
 * happen and can select the value in the read-only field by hand. It is
 * `sr-only` otherwise.
 *
 * The trigger sits at the logical END (`end-0`, `pe-9` reserving the room), so
 * it follows `dir="rtl"` to the left edge.
 */
export const Clipboard = classPart(div, 'relative flex w-full max-w-sm flex-wrap items-center')
export const ClipboardInput = classPart(input, `${inputRecipe} pe-9 font-mono`)
export const ClipboardTrigger = classPart(
  button,
  "absolute top-0 end-0 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-copied:text-primary data-failed:text-destructive [&_svg:not([class*='size-'])]:size-4",
)
export const ClipboardIndicator = classPart(
  span,
  'sr-only data-failed:not-sr-only data-failed:basis-full data-failed:pt-1.5 data-failed:text-xs data-failed:text-destructive',
)
