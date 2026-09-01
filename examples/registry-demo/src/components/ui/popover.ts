import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { floatingOverlayMotionRecipe } from '../../lib/floating-motion'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn), minus one class:
 * `origin-(--radix-popover-content-transform-origin)`. That custom property is
 * written by Radix's positioning engine; LLui's floating layer does not set it,
 * so the class would resolve to `transform-origin: var(--undefined)`. Dropping
 * it means the zoom animation scales from the element's centre rather than from
 * the trigger's edge — the only visual difference in this file.
 *
 * The floating wrapper is built by `overlay()`, so its z-index goes through
 * `positionerClass: 'z-popover'`.
 */
export const PopoverContent = classPart(
  div,
  `z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden ${floatingOverlayMotionRecipe}`,
)
export const PopoverHeader = classPart(div, 'flex flex-col gap-1 text-sm')
export const PopoverArrow = classPart(
  div,
  'size-2.5 rotate-45 rounded-[2px] border border-border bg-popover',
)
