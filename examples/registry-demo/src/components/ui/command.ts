import { div, input, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's Command wraps the `cmdk`
 * library, so its recipe carries a block of `[&_[cmdk-*]]` selectors targeting
 * that library's own attributes. Those are dropped here — `cmdk` is not in play;
 * `@llui/components/patterns/command-menu` supplies the filtering, highlight
 * movement and Enter-to-run, and publishes `data-highlighted` like every other
 * LLui list. The remaining recipes are shadcn's verbatim.
 *
 * Render the empty state: a palette that shows a blank box for "no results"
 * reads as broken.
 */
export const Command = classPart(
  div,
  'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
)
export const CommandInputWrapper = classPart(div, 'flex h-9 items-center gap-2 border-b px-3')
export const CommandInput = classPart(
  input,
  'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
)
export const CommandList = classPart(
  div,
  'max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto',
)
export const CommandEmpty = classPart(div, 'py-6 text-center text-sm')
export const CommandGroup = classPart(div, 'overflow-hidden p-1 text-foreground')
export const CommandGroupLabel = classPart(
  div,
  'px-2 py-1.5 text-xs font-medium text-muted-foreground',
)
export const CommandItem = classPart(
  div,
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
)
export const CommandShortcut = classPart(
  span,
  'ml-auto text-xs tracking-widest text-muted-foreground',
)
export const CommandSeparator = classPart(div, '-mx-1 h-px bg-border')
