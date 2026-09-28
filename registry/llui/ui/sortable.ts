import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Sortable — skin for `@llui/components/sortable`. No shadcn counterpart.
 *
 * THREE states, and conflating them is the usual mistake: `data-dragging` is on
 * the item being carried, `data-over` on the item a drop would land on, and
 * `data-shift` (`'up'` / `'down'`) on the items that must move out of the way.
 * A list that styles only `data-dragging` gives no feedback about WHERE the
 * drop goes, which is the whole affordance.
 *
 * The dragged item stays in place rather than being hidden: it is still the
 * item under the pointer, and removing it collapses the list under the cursor.
 * It is marked by a dashed edge and a muted fill, NOT `opacity-50`: its label
 * must stay legible (a keyboard grab has no pointer to show where it is), and
 * half opacity took it to 3.69:1 (#268 audit).
 *
 * `touch-none` on the handle is required, not cosmetic — without it the browser
 * claims the gesture for scrolling and the drag never starts on touch.
 *
 * The handle is also the KEYBOARD path (Space grabs, arrows move, Escape
 * cancels): it carries a focus ring, and a keyboard grab — `aria-pressed` on
 * the handle — is shown in the primary colour, since there is no pointer
 * position to show where the item is being carried (#266).
 *
 * A screen-reader user hears the drag through the machine's `liveRegion`
 * ("Picked up Apple, item 2 of 5.", each move, the drop, a cancel) and learns
 * the keys from its `instructions`, which every handle names in
 * `aria-describedby`. Render BOTH, outside the list. Their bags carry `text`
 * for the element's CHILD, not an attribute, so spread the rest:
 *
 *   const { text: live, ...liveAttrs } = parts.liveRegion
 *   const { text: howTo, ...howToAttrs } = parts.instructions
 *   SortableLiveRegion({ ...liveAttrs }, [text(live)])
 *   SortableInstructions({ ...howToAttrs }, [text(howTo)])
 *
 * The live region is `sr-only`, never `hidden`: a `display: none` region is
 * never announced. The instructions part carries `hidden` itself.
 */
export const Sortable = classPart(div, 'flex flex-col gap-1.5')
export const SortableItem = classPart(
  div,
  'flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-xs transition-[colors,transform] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-dragging:border-dashed data-dragging:bg-muted data-dragging:shadow-md data-over:border-primary data-[shift=down]:translate-y-1 data-[shift=up]:-translate-y-1 motion-reduce:transition-none',
)
export const SortableHandle = classPart(
  div,
  "flex cursor-grab touch-none items-center text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:text-primary [&_svg:not([class*='size-'])]:size-4",
)
/** The machine's polite live region: visually hidden, still announced. */
export const SortableLiveRegion = classPart(div, 'sr-only')
/**
 * The handles' description. The part carries `hidden` (a directly referenced
 * hidden element still describes); `sr-only` keeps it off-screen even if a
 * caller drops that attribute.
 */
export const SortableInstructions = classPart(div, 'sr-only')
