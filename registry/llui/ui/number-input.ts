import { button, div, input } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** NumberInput — skin for `@llui/components/number-input`. No shadcn
 * equivalent; the package owns clamping, step, and press-and-hold repeat. */
export const NumberInput = classPart(
  div,
  'inline-flex h-9 items-center rounded-md border border-border bg-transparent shadow-sm transition-colors duration-fast focus-within:ring-2 focus-within:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
)
export const NumberInputControl = classPart(
  input,
  'h-full w-16 border-0 bg-transparent px-2 text-center text-sm tabular-nums outline-none',
)
export const NumberInputDecrement = classPart(
  button,
  'inline-flex h-full w-8 items-center justify-center rounded-l-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const NumberInputIncrement = classPart(
  button,
  'inline-flex h-full w-8 items-center justify-center rounded-r-md text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
