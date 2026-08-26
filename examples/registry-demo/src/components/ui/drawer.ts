import { button, div, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'
import { XIcon } from './icons'

/**
 * Drawer — ported from shadcn/ui (MIT © 2023 shadcn).
 *
 * This is NOT Sheet under another name, which is why it is its own item.
 * shadcn's `sheet.tsx` is a Radix Dialog flying in from an edge; its
 * `drawer.tsx` wraps **vaul** and is a different component: rounded on the
 * entering edge, capped at `80vh` on the vertical axes, and carrying a grab
 * handle. Both are ported here, separately, because a consumer following either
 * upstream page should get what that page shows.
 *
 * ONE systematic translation, the same shape as the `focus:` →
 * `data-[highlighted]:` rename elsewhere in this registry: vaul writes the
 * direction as `data-vaul-drawer-direction`, `@llui/components/drawer` writes
 * `data-side`. Every one of upstream's `data-[vaul-drawer-direction=…]` rules
 * is `data-[side=…]` here — the values are identical.
 *
 * WHAT IS NOT PORTED: vaul's drag-to-dismiss. `@llui/components/drawer` opens
 * and closes; it has no drag gesture and no velocity dismissal, so the handle
 * below is an AFFORDANCE ONLY — it signals "this panel is dismissable" and does
 * not itself drag. Escape, the backdrop and `closeTrigger` all dismiss. Do not
 * read the handle as evidence the gesture exists.
 */
export const DrawerBackdrop = classPart(
  div,
  'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
)

/**
 * The direction is read from `data-side`, which the MACHINE publishes — it is a
 * `connect` option (`drawerConnect(state, send, { side: 'bottom' })`), so the
 * consumer states it once and every rule follows.
 *
 * Deliberately NOT a `side` variant prop. That would be a second source of
 * truth, and the two silently disagree: a `side: 'bottom'` variant applies the
 * bottom geometry while the element still carries the machine's default
 * `data-side="right"`, so the handle's `group-data-[side=bottom]` matches
 * nothing and it stays hidden on a drawer that is visibly at the bottom.
 * Measured, on the first render of this component.
 *
 * It is also closer to upstream, not further: vaul writes
 * `data-[vaul-drawer-direction=…]` on the element and keys every rule off THAT,
 * for the same reason.
 */
export const DrawerContent = classPart(
  div,
  'group/drawer-content fixed z-50 flex h-auto flex-col bg-background data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:mb-24 data-[side=top]:max-h-[80vh] data-[side=top]:rounded-b-lg data-[side=top]:border-b data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:mt-24 data-[side=bottom]:max-h-[80vh] data-[side=bottom]:rounded-t-lg data-[side=bottom]:border-t data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:w-3/4 data-[side=left]:border-r sm:data-[side=right]:max-w-sm sm:data-[side=left]:max-w-sm',
)

/**
 * The grab handle. Upstream renders it inside `DrawerContent` and shows it only
 * on the BOTTOM drawer — a handle on a side panel points the wrong way — which
 * is what `group-data-[side=bottom]/drawer-content:block` does here.
 *
 * Affordance only; see the note above.
 */
export const DrawerHandle = classPart(
  div,
  'mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full bg-muted group-data-[side=bottom]/drawer-content:block',
)

/** Centred on the horizontal drawers, left-aligned on the side ones — a header
 * centred over a narrow side panel reads as a dialog rather than a sheet. */
export const DrawerHeader = classPart(
  div,
  'flex flex-col gap-0.5 p-4 group-data-[side=bottom]/drawer-content:text-center group-data-[side=top]/drawer-content:text-center md:gap-1.5 md:text-left',
)
export const DrawerFooter = classPart(div, 'mt-auto flex flex-col gap-2 p-4')
export const DrawerTitle = classPart(div, 'font-semibold text-foreground')
export const DrawerDescription = classPart(p, 'text-sm text-muted-foreground')

const drawerCloseRecipe =
  "absolute top-4 right-4 rounded-xs opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4"

/** Renders its own ✕, as the other overlay closes in this registry do. */
export function DrawerClose(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return button(
    { type: 'button', ...rest, class: mergeClass(drawerCloseRecipe, className) },
    children.length > 0 ? children : [XIcon({ class: 'size-4' })],
  )
}
