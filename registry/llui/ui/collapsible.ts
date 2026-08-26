import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Collapsible — skin for `@llui/components/collapsible`. */
export const Collapsible = classPart(div, 'flex flex-col gap-2')
export const CollapsibleTrigger = classPart(
  button,
  'flex items-center justify-between gap-2 rounded-md text-sm font-medium transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const CollapsibleContent = classPart(div, 'text-sm data-[state=closed]:hidden')
