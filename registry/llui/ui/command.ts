import { div, input, span, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass } from '@/lib/utils'
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
 * reads as broken. `CommandEmpty` is an UNCONDITIONAL recipe and does not hide
 * itself — toggling it is the consumer's, because the two machines that use
 * these recipes disagree about how: `patterns/command-menu`'s `empty` part
 * publishes `data-empty` (pair it with `hidden data-empty:block`), while
 * `combobox`'s is a bare marker with no state at all, so a `data-empty` rule
 * baked in here would leave IT permanently hidden. Left untoggled it renders
 * "No results" above a full list.
 */
export const Command = classPart(
  div,
  'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
)
const commandInputWrapperRecipe = 'flex h-9 items-center gap-2 border-b px-3'
const commandInputRecipe =
  'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'

/**
 * The filter field: the bordered row, its search glyph, and the `<input>` — ONE
 * component, as shadcn's is. Spread the machine's `input` bag; `class` lands on
 * the `<input>`, matching upstream's `className`.
 *
 * These used to be two exports (`CommandInputWrapper` + a bare `CommandInput`),
 * which diverged from upstream and made the wrapper something a caller had to
 * remember. Predictably, one of two call sites forgot: the searchable-select
 * demo rendered a filter field with no border, no padding and no glyph, flush
 * against the top-left of the popover. Upstream cannot be got wrong this way
 * because upstream has nothing to forget, so this now has nothing either.
 */
export function CommandInput(props: ElProps = {}): Mountable {
  const { class: className, ...rest } = props
  return div({ class: commandInputWrapperRecipe }, [
    SearchIcon({ class: 'size-4 shrink-0 opacity-50' }),
    input({ ...rest, class: mergeClass(commandInputRecipe, className) }),
  ])
}
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
