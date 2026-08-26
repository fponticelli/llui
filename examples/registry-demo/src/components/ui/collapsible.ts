import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * shadcn's Collapsible is unstyled — it re-exports Radix's primitives with no
 * `cn()` call at all, leaving the appearance entirely to the caller. These
 * recipes therefore carry only what LLui genuinely needs: the trigger's focus
 * ring (shadcn's shared idiom) and hiding the content when closed, which Radix
 * does with its own `hidden` attribute and LLui expresses as a data variant.
 */
export const Collapsible = classPart(div, 'flex flex-col gap-2')
export const CollapsibleTrigger = classPart(
  button,
  'flex items-center justify-between gap-2 rounded-md text-sm font-medium transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const CollapsibleContent = classPart(div, 'text-sm data-[state=closed]:hidden')
