import { button, div, label, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** RadioGroup — skin for `@llui/components/radio-group`. */
export const RadioGroup = classPart(
  div,
  'grid gap-2 data-[orientation=horizontal]:grid-flow-col data-[orientation=horizontal]:auto-cols-max',
)
export const RadioGroupItem = classPart(
  button,
  'aspect-square size-4 shrink-0 rounded-full border border-border text-primary shadow-sm transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
)
export const RadioGroupIndicator = classPart(
  span,
  'flex size-full items-center justify-center after:block after:size-2 after:rounded-full after:bg-primary data-[state=unchecked]:after:hidden',
)
export const RadioGroupLabel = classPart(label, 'text-sm leading-none font-medium select-none')
