import { button, div, p } from '@llui/dom'
import { classPart, createVariantsPart } from '../../lib/utils'

/**
 * Sonner / Toast — skin for `@llui/components/toast`. shadcn's toast component
 * is a wrapper around the `sonner` library; LLui's machine is `toast`, and both
 * names are exported.
 *
 * The `region` part is the live region the package announces through. Render it
 * once, near the root — one region for the app, not one per toast, or screen
 * readers announce the container instead of the message.
 */
export const ToastRegion = classPart(
  div,
  'pointer-events-none fixed bottom-4 right-4 z-tooltip flex w-full max-w-sm flex-col gap-2',
)

export const Toast = createVariantsPart(div, {
  base: 'pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border p-4 shadow-lg transition-all duration-normal data-[state=closed]:translate-x-2 data-[state=closed]:opacity-0',
  variants: {
    variant: {
      default: 'bg-popover text-popover-foreground',
      destructive: 'border-destructive/50 bg-popover text-destructive',
      success: 'border-primary/40 bg-popover text-popover-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export const ToastTitle = classPart(div, 'text-sm font-medium')
export const ToastDescription = classPart(p, 'text-sm text-muted-foreground')
export const ToastClose = classPart(
  button,
  'ml-auto shrink-0 text-muted-foreground transition-colors duration-fast hover:text-foreground',
)

export { Toast as Sonner, ToastRegion as Toaster }
