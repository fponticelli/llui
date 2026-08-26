import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** HoverCard — skin for `@llui/components/hover-card`. Pass
 * `positionerClass: 'z-popover'` to `overlay()`. */
export const HoverCardContent = classPart(
  div,
  'w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none transition-opacity duration-fast data-[state=closed]:opacity-0',
)
export const HoverCardArrow = classPart(div, 'size-2.5 rotate-45 border border-border bg-popover')
