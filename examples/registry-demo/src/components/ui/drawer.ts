import { button, div, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'
import { overlayReducedMotionRecipe } from '../../lib/floating-motion'
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
  `fixed inset-0 z-50 bg-black/50 forced-colors:bg-[CanvasText] forced-colors:opacity-50 data-[state=opening]:animate-in data-[state=opening]:fade-in-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closing]:animate-out data-[state=closing]:fade-out-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 ${overlayReducedMotionRecipe}`,
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
  `group/drawer-content fixed z-50 flex h-auto max-w-full max-h-full flex-col overflow-y-auto overscroll-contain wrap-break-word bg-background forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] data-[state=opening]:animate-in data-[state=opening]:duration-500 data-[state=open]:animate-in data-[state=open]:duration-500 data-[state=closing]:animate-out data-[state=closing]:duration-300 data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:mb-24 data-[side=top]:max-h-[80vh] data-[side=top]:rounded-b-lg data-[side=top]:border-b data-[side=top]:data-[state=opening]:slide-in-from-top data-[side=top]:data-[state=open]:slide-in-from-top data-[side=top]:data-[state=closing]:slide-out-to-top data-[side=top]:data-[state=closed]:slide-out-to-top data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:mt-24 data-[side=bottom]:max-h-[80vh] data-[side=bottom]:rounded-t-lg data-[side=bottom]:border-t data-[side=bottom]:data-[state=opening]:slide-in-from-bottom data-[side=bottom]:data-[state=open]:slide-in-from-bottom data-[side=bottom]:data-[state=closing]:slide-out-to-bottom data-[side=bottom]:data-[state=closed]:slide-out-to-bottom data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-[state=opening]:slide-in-from-right data-[side=right]:data-[state=open]:slide-in-from-right data-[side=right]:data-[state=closing]:slide-out-to-right data-[side=right]:data-[state=closed]:slide-out-to-right data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-[state=opening]:slide-in-from-left data-[side=left]:data-[state=open]:slide-in-from-left data-[side=left]:data-[state=closing]:slide-out-to-left data-[side=left]:data-[state=closed]:slide-out-to-left sm:data-[side=right]:max-w-sm sm:data-[side=left]:max-w-sm ${overlayReducedMotionRecipe}`,
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

/** Centered on the horizontal drawers, start-aligned on the side ones — a
 * centered header over a narrow side panel reads as a dialog rather than a
 * sheet. */
export const DrawerHeader = classPart(
  div,
  'flex flex-col gap-0.5 p-4 group-data-[side=bottom]/drawer-content:text-center group-data-[side=top]/drawer-content:text-center md:gap-1.5 md:text-start',
)
export const DrawerFooter = classPart(div, 'mt-auto flex flex-col gap-2 p-4')
export const DrawerTitle = classPart(div, 'font-semibold text-foreground')
export const DrawerDescription = classPart(p, 'text-sm text-muted-foreground')

const drawerCloseRecipe =
  "absolute top-4 end-4 rounded-xs opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4"

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
