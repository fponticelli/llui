import { button, div, p } from '@llui/dom'
import { classPart, createVariantsPart } from '@/lib/utils'
import { overlayReducedMotionRecipe } from '@/lib/floating-motion'

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
  'pointer-events-none fixed z-50 flex w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] flex-col gap-2 overflow-y-auto overscroll-contain wrap-break-word data-[placement=top]:top-4 data-[placement=top]:left-1/2 data-[placement=top]:-translate-x-1/2 data-[placement=top-start]:top-4 data-[placement=top-start]:start-4 data-[placement=top-end]:top-4 data-[placement=top-end]:end-4 data-[placement=bottom]:bottom-4 data-[placement=bottom]:left-1/2 data-[placement=bottom]:-translate-x-1/2 data-[placement=bottom-start]:bottom-4 data-[placement=bottom-start]:start-4 data-[placement=bottom-end]:end-4 data-[placement=bottom-end]:bottom-4',
)

export const Toast = createVariantsPart(div, {
  base: `pointer-events-auto flex w-full min-w-0 items-start gap-3 wrap-break-word rounded-lg border p-4 shadow-lg forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] data-[state=closing]:animate-out data-[state=closing]:fade-out-0 ltr:data-[state=closing]:slide-out-to-right rtl:data-[state=closing]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:fade-in-0 ltr:data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left ${overlayReducedMotionRecipe}`,
  variants: {
    variant: {
      info: 'border-sky-500/50 bg-popover text-popover-foreground forced-colors:border-s-4 forced-colors:border-solid',
      error:
        'border-destructive/50 bg-popover text-destructive forced-colors:border-s-4 forced-colors:border-solid forced-colors:text-[LinkText] forced-colors:underline forced-colors:decoration-2',
      success:
        'border-primary/40 bg-popover text-popover-foreground forced-colors:border-s-4 forced-colors:border-double',
      warning:
        'border-amber-500/50 bg-popover text-popover-foreground forced-colors:border-s-4 forced-colors:border-dashed',
      loading:
        'cursor-progress bg-popover text-popover-foreground forced-colors:border-s-4 forced-colors:border-dotted',
      custom:
        'border-violet-500/50 bg-popover text-popover-foreground forced-colors:border-s-4 forced-colors:border-solid',
    },
  },
  defaultVariants: { variant: 'info' },
})

export const ToastTitle = classPart(div, 'text-sm leading-none font-medium')
export const ToastDescription = classPart(
  p,
  'min-w-0 text-sm wrap-break-word text-muted-foreground',
)
export const ToastClose = classPart(
  button,
  'ms-auto shrink-0 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden',
)

export { Toast as Sonner, ToastRegion as Toaster }
