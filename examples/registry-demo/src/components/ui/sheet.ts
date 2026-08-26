import { button, div, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, createVariantsPart, mergeClass, splitArgs } from '../../lib/utils'
import { XIcon } from './icons'

/**
 * Sheet — ported verbatim from shadcn/ui (MIT © 2023 shadcn). shadcn calls it
 * Sheet; LLui's machine is `drawer`, and both names are exported.
 *
 * As with Dialog, the content positions ITSELF, so pass
 * `positionerClass: 'contents'` and render the backdrop inside `content()`.
 *
 * `side` is a variant on the CONTENT rather than something the machine decides,
 * because the machine only owns open/close and focus — which edge it flies in
 * from is presentation.
 */
export const SheetBackdrop = classPart(
  div,
  'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
)

export const SheetContent = createVariantsPart(div, {
  base: 'fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500',
  variants: {
    side: {
      right:
        'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
      left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
      top: 'inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
      bottom:
        'inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
    },
  },
  defaultVariants: { side: 'right' },
})

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

export {
  SheetContent as DrawerContent,
  SheetBackdrop as DrawerBackdrop,
  SheetHeader as DrawerHeader,
  SheetTitle as DrawerTitle,
  SheetDescription as DrawerDescription,
  SheetFooter as DrawerFooter,
  SheetClose as DrawerClose,
}
