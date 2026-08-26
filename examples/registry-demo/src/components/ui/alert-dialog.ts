import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

export {
  DialogBackdrop as AlertDialogBackdrop,
  DialogContent as AlertDialogContent,
  DialogDescription as AlertDialogDescription,
  DialogFooter as AlertDialogFooter,
  DialogTitle as AlertDialogTitle,
} from './dialog'

/**
 * AlertDialog — skin for `@llui/components/alert-dialog`, which is `dialog` with
 * `closeOnOutsideClick` defaulted OFF: a destructive confirmation must not be
 * dismissible by a stray click. The recipes are the dialog's, re-exported rather
 * than restated.
 *
 * There is deliberately no `AlertDialogClose`. The pattern is an explicit
 * cancel/confirm pair in the footer — a corner ✕ next to "Delete permanently"
 * is exactly the ambiguity this component exists to remove.
 */
export const AlertDialogActions = classPart(
  div,
  'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
)
