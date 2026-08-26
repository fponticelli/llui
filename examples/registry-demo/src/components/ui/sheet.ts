import { button, div, h2, p } from '@llui/dom'
import { classPart, createVariantsPart } from '../../lib/utils'

/**
 * Sheet — skin for `@llui/components/drawer`: a panel anchored to one edge.
 * shadcn calls it Sheet, LLui's machine is `drawer`; both names are here so
 * neither audience has to translate.
 *
 * `side` is a variant on the CONTENT rather than something the package decides,
 * because the machine only owns open/close and focus — which edge it flies in
 * from is presentation. Pass `positionerClass: 'fixed inset-0 z-dialog flex'`
 * plus the matching justification.
 */
export const SheetContent = createVariantsPart(div, {
  base: 'relative flex h-full w-full flex-col gap-4 bg-popover p-6 text-popover-foreground shadow-lg transition-transform duration-normal',
  variants: {
    side: {
      right: 'ml-auto max-w-sm border-l border-border data-[state=closed]:translate-x-full',
      left: 'mr-auto max-w-sm border-r border-border data-[state=closed]:-translate-x-full',
      top: 'mb-auto max-h-96 border-b border-border data-[state=closed]:-translate-y-full',
      bottom: 'mt-auto max-h-96 border-t border-border data-[state=closed]:translate-y-full',
    },
  },
  defaultVariants: { side: 'right' },
})

export const SheetBackdrop = classPart(
  div,
  'absolute inset-0 bg-black/50 transition-opacity duration-fast data-[state=closed]:opacity-0',
)
export const SheetHeader = classPart(div, 'flex flex-col gap-1.5')
export const SheetTitle = classPart(h2, 'text-lg leading-none font-semibold')
export const SheetDescription = classPart(p, 'text-sm text-muted-foreground')
export const SheetFooter = classPart(div, 'mt-auto flex flex-col gap-2')
export const SheetClose = classPart(
  button,
  'absolute top-4 right-4 rounded-sm text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
)

export {
  SheetContent as DrawerContent,
  SheetBackdrop as DrawerBackdrop,
  SheetHeader as DrawerHeader,
  SheetTitle as DrawerTitle,
  SheetDescription as DrawerDescription,
  SheetFooter as DrawerFooter,
  SheetClose as DrawerClose,
}
