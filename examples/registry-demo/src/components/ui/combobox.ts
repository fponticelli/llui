/**
 * Combobox.
 *
 * shadcn/ui ships NO `combobox.tsx` — its Combobox docs are a COMPOSITION of
 * Popover + Command, so there is no upstream recipe to port and inventing one
 * would guarantee drift from the palette it is meant to look like. This module
 * therefore re-exports Command's recipes under Combobox names, and adds only the
 * two parts LLui's machine has that a cmdk-based one does not: the trigger
 * button and the `sr-only` live region.
 *
 * Render the live region. It announces the result count as the query changes —
 * without it a screen-reader user gets no feedback that typing did anything.
 */
import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

export {
  Command as ComboboxRoot,
  CommandInput as ComboboxControl,
  CommandList as ComboboxList,
  CommandEmpty as ComboboxEmpty,
  CommandGroup as ComboboxGroup,
  CommandGroupLabel as ComboboxGroupLabel,
  CommandItem as ComboboxItem,
  CommandSeparator as ComboboxSeparator,
} from './command'

export { SelectContent as ComboboxContent } from './select'

export const ComboboxTrigger = classPart(
  button,
  'absolute top-0 right-0 flex size-9 items-center justify-center text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
)
export const ComboboxLiveRegion = classPart(div, 'sr-only')
