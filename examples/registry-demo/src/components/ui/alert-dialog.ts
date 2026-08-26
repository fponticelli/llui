import { div } from '@llui/dom'
import { classPart, classPartWithDefaults } from '../../lib/utils'

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
export const AlertDialogContent = classPartWithDefaults(
  div,
  'group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 data-[size=sm]:max-w-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[size=default]:sm:max-w-lg',
  // shadcn's React component defaults `size="default"`; a recipe-only port loses
  // that, and the `data-[size=default]:` half of this recipe — the `sm:max-w-lg`
  // cap, plus the header's whole left-aligned layout, which reads it through
  // `group/alert-dialog-content` — then matches nothing. The dialog silently
  // renders full-width with a centred header at every breakpoint.
  { 'data-size': 'default' },
)
export const AlertDialogHeader = classPart(
  div,
  'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[part=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[part=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:has-data-[part=alert-dialog-media]:grid-rows-[auto_1fr] sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left',
)
export const AlertDialogFooter = classPart(
  div,
  'flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end',
)
/** An icon or illustration above the title. Its presence switches the header to
 * a three-row grid, and on `sm:` with the default size moves the title into
 * column 2 beside it — which is why the title carries the matching
 * `group-has-data-[part=alert-dialog-media]` rule. */
export const AlertDialogMedia = classPart(
  div,
  "mb-2 inline-flex size-16 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-8",
)
export const AlertDialogTitleText = classPart(
  div,
  'text-lg font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[part=alert-dialog-media]/alert-dialog-content:col-start-2',
)

export { AlertDialogFooter as AlertDialogActions }
