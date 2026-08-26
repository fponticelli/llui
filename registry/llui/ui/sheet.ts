import { button, div, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '@/lib/utils'
import { XIcon } from '@/ui/icons'

/**
 * Sheet — ported verbatim from shadcn/ui (MIT © 2023 shadcn). shadcn calls it
 * Sheet; LLui's machine is `drawer`, and both drive that same machine.
 *
 * These used to be re-exported under `Drawer*` names, which conflated two
 * DIFFERENT upstream components: shadcn's `drawer.tsx` wraps vaul and is
 * rounded on the entering edge, capped at `80vh`, and carries a grab handle.
 * `@/ui/drawer` now ports that separately; a consumer following either upstream
 * page gets what that page shows.
 *
 * As with Dialog, the content positions ITSELF, so pass
 * `positionerClass: 'contents'` and render the backdrop inside `content()`.
 *
 * The edge is the MACHINE's (`connect(..., { side })`), not a variant — see the
 * note on `SheetContent`.
 */
export const SheetBackdrop = classPart(
  div,
  'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
)

/**
 * The edge comes from `data-side`, which the MACHINE publishes — it is a
 * `connect` option (`drawerConnect(state, send, { side: 'left' })`).
 *
 * Upstream makes `side` a PROP, and it stayed one here at first. That is a
 * second source of truth, and the two silently disagree: the variant applies
 * one edge's geometry while the element still carries the machine's
 * `data-side`, so any rule keyed off the attribute — including this recipe's
 * own slide-in direction — targets the other edge. It only looked fine because
 * both defaulted to `right`. `drawer.ts` hit the visible version of this on its
 * first render; see the note there.
 */
export const SheetContent = classPart(
  div,
  'fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-[state=closed]:slide-out-to-right data-[side=right]:data-[state=open]:slide-in-from-right data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-[state=closed]:slide-out-to-left data-[side=left]:data-[state=open]:slide-in-from-left data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-[state=closed]:slide-out-to-top data-[side=top]:data-[state=open]:slide-in-from-top data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-[state=closed]:slide-out-to-bottom data-[side=bottom]:data-[state=open]:slide-in-from-bottom sm:data-[side=right]:max-w-sm sm:data-[side=left]:max-w-sm',
)

export const SheetHeader = classPart(div, 'flex flex-col gap-1.5 p-4')
export const SheetFooter = classPart(div, 'mt-auto flex flex-col gap-2 p-4')
export const SheetTitle = classPart(div, 'font-semibold text-foreground')
export const SheetDescription = classPart(p, 'text-sm text-muted-foreground')
const sheetCloseRecipe =
  'absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary'

/** Renders its own ✕, as shadcn's does. */
export function SheetClose(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return button(
    { type: 'button', ...rest, class: mergeClass(sheetCloseRecipe, className) },
    children.length > 0 ? children : [XIcon({ class: 'size-4' })],
  )
}
