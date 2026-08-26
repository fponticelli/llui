import { div, input } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Command — skin for `@llui/components/patterns/command-menu`, the ⌘K palette
 * built on `listbox` + `dialog`.
 *
 * The pattern owns filtering, highlight movement and Enter-to-run. Render the
 * empty state: a palette that shows a blank box for "no results" reads as broken.
 */
export const Command = classPart(
  div,
  'flex w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground',
)
export const CommandInput = classPart(
  input,
  'h-11 w-full border-0 border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground',
)
export const CommandList = classPart(div, 'max-h-80 overflow-y-auto overflow-x-hidden p-1')
export const CommandEmpty = classPart(div, 'py-8 text-center text-sm text-muted-foreground')
export const CommandGroup = classPart(div, 'overflow-hidden p-1')
export const CommandGroupLabel = classPart(
  div,
  'px-2 py-1.5 text-xs font-medium text-muted-foreground',
)
export const CommandItem = classPart(
  div,
  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
)
export const CommandSeparator = classPart(div, '-mx-1 my-1 h-px bg-border')
