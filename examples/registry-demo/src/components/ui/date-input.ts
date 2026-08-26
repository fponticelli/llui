import { button, div, input, p } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { inputRecipe } from './input'

/**
 * Date input — skin for `@llui/components/date-input`, the typed alternative to
 * the Calendar's grid. No shadcn counterpart.
 *
 * The invalid state is expressed TWICE by the machine and each spelling has its
 * own job: the input carries `aria-invalid`, which the `Input` recipe already
 * styles (`aria-invalid:border-destructive`) and which is what assistive tech
 * reads; the root carries `data-invalid` for a rule that has to reach a sibling.
 * Neither is redundant — do not drop one for the other.
 *
 * `errorText` carries its own reactive `hidden` and `role="alert"`, so it stays
 * mounted and announces on change. Toggling it with `show` instead would
 * unmount the live region and announce nothing.
 */
export const DateInput = classPart(div, 'relative')
export const DateInputControl = classPart(input, `${inputRecipe} pr-9`)
export const DateInputClearTrigger = classPart(
  button,
  "absolute top-0 right-0 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
)
export const DateInputErrorText = classPart(p, 'mt-1.5 text-sm text-destructive')
