import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Sortable — skin for `@llui/components/sortable`. No shadcn counterpart.
 *
 * THREE states, and conflating them is the usual mistake: `data-dragging` is on
 * the item being carried, `data-over` on the item a drop would land on, and
 * `data-shift` (`'up'` / `'down'`) on the items that must move out of the way.
 * A list that styles only `data-dragging` gives no feedback about WHERE the
 * drop goes, which is the whole affordance.
 *
 * The dragged item keeps `opacity-50` rather than being hidden: it is still the
 * item under the pointer, and removing it collapses the list under the cursor.
 *
 * `touch-none` on the handle is required, not cosmetic — without it the browser
 * claims the gesture for scrolling and the drag never starts on touch.
 */
export const Sortable = classPart(div, 'flex flex-col gap-1.5')
export const SortableItem = classPart(
  div,
  'flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-xs transition-[colors,transform] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-dragging:opacity-50 data-dragging:shadow-md data-over:border-primary data-[shift=down]:translate-y-1 data-[shift=up]:-translate-y-1',
)
export const SortableHandle = classPart(
  div,
  "flex cursor-grab touch-none items-center text-muted-foreground active:cursor-grabbing [&_svg:not([class*='size-'])]:size-4",
)
