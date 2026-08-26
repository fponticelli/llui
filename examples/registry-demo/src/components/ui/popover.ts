import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

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
  'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
)
export const PopoverHeader = classPart(div, 'flex flex-col gap-1 text-sm')
export const PopoverArrow = classPart(
  div,
  'size-2.5 rotate-45 rounded-[2px] border border-border bg-popover',
)
