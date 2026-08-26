import { button, div, label, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const RadioGroup = classPart(div, 'grid gap-3')
export const RadioGroupItem = classPart(
  button,
  'aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
)
/** The dot. shadcn renders a `<CircleIcon className="fill-primary">` inside a
 * centring wrapper; with no icon dependency here the same mark is drawn as an
 * `after:` pseudo-element at the identical size and position. */
export const RadioGroupIndicator = classPart(
  span,
  'relative flex items-center justify-center after:absolute after:top-1/2 after:left-1/2 after:size-2 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-primary data-[state=unchecked]:after:hidden',
)
export const RadioGroupLabel = classPart(
  label,
  'flex items-center gap-2 text-sm leading-none font-medium select-none',
)
