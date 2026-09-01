import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { floatingOverlayMotionRecipe } from '@/lib/floating-motion'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with LLui's shared presence,
 * viewport-containment, and forced-colors policies. The Radix-specific
 * `origin-(--radix-tooltip-content-transform-origin)` is omitted; see
 * `popover.ts` for why.
 *
 * Note the colours: shadcn's tooltip is INVERTED (`bg-foreground` on
 * `text-background`), not a popover surface. It reads as a transient hint rather
 * than a panel, and the arrow matches by using `bg-foreground` too.
 */
export const TooltipContent = classPart(
  div,
  `z-50 w-fit max-w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain wrap-break-word rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[CanvasText] forced-colors:text-[Canvas] ${floatingOverlayMotionRecipe}`,
)
export const TooltipArrow = classPart(
  div,
  'absolute z-50 size-2.5 rotate-45 rounded-[2px] bg-foreground fill-foreground forced-colors:bg-[CanvasText] forced-colors:fill-[CanvasText]',
)
