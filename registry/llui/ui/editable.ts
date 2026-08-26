import { button, div, input, span } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { inputRecipe } from '@/ui/input'
import { buttonVariants } from '@/ui/button'

/**
 * Editable — skin for `@llui/components/editable` (click-to-edit text). No
 * shadcn counterpart.
 *
 * The preview and the input are BOTH always in the DOM; the machine decides
 * which is shown. So the preview must be sized like the input it swaps with —
 * `h-9` and matching padding — or the row jumps on every edit. That is the only
 * non-obvious thing here, and it is invisible until you click.
 *
 * `data-editing` is on the ROOT, so a rule can reach the trigger row without
 * knowing which control is live.
 */
export const Editable = classPart(
  div,
  'flex items-center gap-1.5 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const EditablePreview = classPart(
  span,
  'flex h-9 min-w-0 cursor-text items-center rounded-md px-3 py-1 text-base hover:bg-accent/50 md:text-sm',
)
export const EditableInput = classPart(input, inputRecipe)
export const EditableEditTrigger = classPart(
  button,
  buttonVariants({ variant: 'ghost', size: 'icon' }),
)
export const EditableSubmitTrigger = classPart(
  button,
  buttonVariants({ variant: 'default', size: 'sm' }),
)
export const EditableCancelTrigger = classPart(
  button,
  buttonVariants({ variant: 'ghost', size: 'sm' }),
)
