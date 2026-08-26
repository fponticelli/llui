import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

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
  'z-50 w-fit animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
)
export const TooltipArrow = classPart(
  div,
  'z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground',
)
