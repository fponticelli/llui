import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { floatingOverlayMotionRecipe } from '../../lib/floating-motion'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn), minus
 * `origin-(--radix-hover-card-content-transform-origin)` — see `popover.ts`. */
export const HoverCardContent = classPart(
  div,
  `z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden ${floatingOverlayMotionRecipe}`,
)
export const HoverCardArrow = classPart(
  div,
  'size-2.5 rotate-45 rounded-[2px] border border-border bg-popover',
)
