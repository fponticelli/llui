import { button, div, p } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * Tour — skin for `@llui/components/tour`. No shadcn counterpart; the card is
 * the Popover's vocabulary because that is what a coach mark is.
 *
 * The SPOTLIGHT is the same enormous-`box-shadow` trick `image-cropper` uses,
 * and for the same reason: the dim is always exactly the complement of wherever
 * the highlighted element is, with no second element to keep in step. It is
 * `pointer-events-none` so the user can still interact with what is being
 * pointed at — a spotlight that blocks its own target is a dead-end step.
 *
 * The machine positions both the spotlight and the card through inline `style`,
 * so this recipe sets no geometry (see `floating-panel`).
 *
 * `data-last` on the root is what turns "Next" into "Done" — style from it
 * rather than counting steps in the view.
 */
export const Tour = classPart(
  div,
  'fixed z-50 flex max-w-xs flex-col gap-2 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none',
)
export const TourBackdrop = classPart(div, 'fixed inset-0 z-40 bg-black/50')
export const TourSpotlight = classPart(
  div,
  'pointer-events-none fixed z-40 rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]',
)
export const TourTitle = classPart(div, 'text-sm leading-none font-semibold')
export const TourDescription = classPart(p, 'text-sm text-muted-foreground')
export const TourProgressText = classPart(p, 'text-xs text-muted-foreground tabular-nums')
export const TourPrevTrigger = classPart(button, buttonVariants({ variant: 'ghost', size: 'sm' }))
export const TourNextTrigger = classPart(button, buttonVariants({ variant: 'default', size: 'sm' }))
export const TourCloseTrigger = classPart(
  button,
  "absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg:not([class*='size-'])]:size-3.5",
)
