import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { floatingOverlayMotionRecipe } from '@/lib/floating-motion'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn), minus
 * `origin-(--radix-tooltip-content-transform-origin)` — see `popover.ts` for why.
 *
 * Note the colours: shadcn's tooltip is INVERTED (`bg-foreground` on
 * `text-background`), not a popover surface. It reads as a transient hint rather
 * than a panel, and the arrow matches by using `bg-foreground` too.
 */
export const TooltipContent = classPart(
  div,
  `z-50 w-fit rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background ${floatingOverlayMotionRecipe}`,
)
export const TooltipArrow = classPart(
  div,
  'z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground',
)
