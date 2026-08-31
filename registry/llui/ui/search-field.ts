import { button, div, input, label } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { inputRecipe } from '@/ui/input'

/**
 * Search field — skin for `@llui/components/search-field`. No shadcn
 * counterpart; the `Input` recipe verbatim plus the two affordances the machine
 * provides.
 *
 * Padded on BOTH sides (`ps-9 pe-9`): the leading glyph and the clear button
 * are absolutely positioned, so without the padding the value runs under them.
 * The leading glyph is the CONSUMER's to render — the machine has no part for
 * it, deliberately, since it is pure decoration.
 *
 * `clearTrigger` carries its own reactive `hidden`, so it disappears on an empty
 * field without a rule here. Do not add a `hidden:` variant of your own; you
 * would be duplicating a decision the machine already made.
 */
export const SearchField = classPart(div, 'relative')
export const SearchFieldLabel = classPart(
  label,
  'mb-1.5 block text-sm leading-none font-medium select-none',
)
export const SearchFieldInput = classPart(input, `${inputRecipe} pe-9 ps-9`)
export const SearchFieldIcon = classPart(
  div,
  "pointer-events-none absolute top-0 start-0 flex size-9 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
)
export const SearchFieldClearTrigger = classPart(
  button,
  "absolute top-0 end-0 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg:not([class*='size-'])]:size-4",
)
