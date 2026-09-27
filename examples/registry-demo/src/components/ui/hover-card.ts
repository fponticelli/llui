import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { floatingOverlayMotionRecipe } from '../../lib/floating-motion'

/** Ported from shadcn/ui (MIT © 2023 shadcn), with LLui's shared presence,
 * viewport-containment, and forced-colors policies. The Radix-specific
 * `origin-(--radix-hover-card-content-transform-origin)` is omitted; see
 * `popover.ts`. */
export const HoverCardContent = classPart(
  div,
  `z-50 w-64 max-w-[calc(100vw-2rem)] max-h-[var(--llui-floating-available-height,calc(100dvh-2rem))] overflow-y-auto overscroll-contain wrap-break-word rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] ${floatingOverlayMotionRecipe}`,
)
export const HoverCardArrow = classPart(
  div,
  'absolute size-2.5 rotate-45 rounded-[2px] border border-border bg-popover forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
)
