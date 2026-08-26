import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

export {
  DialogBackdrop as AlertDialogBackdrop,
  DialogBackdrop as AlertDialogOverlay,
  DialogDescription as AlertDialogDescription,
  DialogTitle as AlertDialogTitle,
} from './dialog'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn).
 *
 * `@llui/components/alert-dialog` is `dialog` with `closeOnOutsideClick`
 * defaulted OFF: a destructive confirmation must not be dismissible by a stray
 * click. Pass `positionerClass: 'contents'` — the content positions itself, as
 * the dialog's does.
 *
 * There is deliberately no `AlertDialogClose`. shadcn does not ship one either:
 * the pattern is an explicit cancel/confirm pair in the footer, and a corner ✕
 * next to "Delete permanently" is exactly the ambiguity this component removes.
 */
export const AlertDialogContent = classPart(
  div,
  'group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[size=sm]:max-w-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[size=default]:sm:max-w-lg',
)
export const AlertDialogHeader = classPart(
  div,
  'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[part=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[part=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left',
)
export const AlertDialogFooter = classPart(
  div,
  'flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end',
)
export { AlertDialogFooter as AlertDialogActions }
