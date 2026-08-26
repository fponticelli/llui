import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * ToggleGroup — skin for `@llui/components/toggle-group`. The items are fused
 * into one control the way ButtonGroup does it, via `[&>*:not(...)]` selectors
 * rather than a class per item, so adding or reordering items stays correct.
 */
export const ToggleGroup = classPart(
  div,
  'inline-flex items-center rounded-md data-[orientation=vertical]:flex-col [&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
)
export const ToggleGroupItem = classPart(
  button,
  'inline-flex h-9 min-w-9 items-center justify-center gap-2 border border-border bg-transparent px-2 text-sm font-medium transition-colors duration-fast outline-none first:rounded-l-md last:rounded-r-md hover:bg-muted focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
