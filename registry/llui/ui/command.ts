import { div, input, span, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '@/lib/utils'
import { SearchIcon } from '@/ui/icons'

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
const commandInputWrapperRecipe = 'flex h-9 items-center gap-2 border-b px-3'

/** Renders its own search glyph, as shadcn's does. */
export function CommandInputWrapper(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div({ ...rest, class: mergeClass(commandInputWrapperRecipe, className) }, [
    SearchIcon({ class: 'size-4 shrink-0 opacity-50' }),
    ...children,
  ])
}
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
