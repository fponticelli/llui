import { button, div, p } from '@llui/dom'
import { classPart, createVariantsPart } from '@/lib/utils'

/**
 * Toast / Sonner.
 *
 * shadcn's `sonner.tsx` contains NO class recipes — it mounts the `sonner`
 * library's `<Toaster />` and hands it theme variables. There is nothing to port
 * verbatim, so these recipes are built from shadcn's own token vocabulary and
 * shared idioms rather than copied: `bg-popover`, `border`, `shadow-lg`, and
 * the `animate-in`/`animate-out` pair every other overlay in this registry uses.
 *
 * `@llui/components/toast` supplies the queue, timers and the live region.
 * Render `ToastRegion` ONCE near the root — one region for the app, not one per
 * toast, or screen readers announce the container instead of the message.
 */
export const ToastRegion = classPart(
  div,
  'pointer-events-none fixed right-0 bottom-0 z-50 flex w-full max-w-100 flex-col gap-2 p-4',
)

export const Toast = createVariantsPart(div, {
  base: 'pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right',
  variants: {
    variant: {
      default: 'bg-popover text-popover-foreground',
      destructive: 'border-destructive/50 bg-popover text-destructive',
      success: 'border-primary/40 bg-popover text-popover-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export const ToastTitle = classPart(div, 'text-sm leading-none font-medium')
export const ToastDescription = classPart(p, 'text-sm text-muted-foreground')
export const ToastClose = classPart(
  button,
  'ml-auto shrink-0 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden',
)

export { Toast as Sonner, ToastRegion as Toaster }
