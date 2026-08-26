import { button, div, option, select as selectEl } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Select — skin for `@llui/components/select`. Pass
 * `positionerClass: 'z-popover'` to `overlay()`.
 *
 * Render `hiddenSelect` / `hiddenOption`: they are what carries the value into a
 * native form submit. `sr-only` rather than `hidden`, because a hidden control
 * is excluded from `FormData` in some browsers.
 */
export const SelectTrigger = classPart(
  button,
  'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-sm transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[placeholder]:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
)
export const SelectContent = classPart(
  div,
  'max-h-72 min-w-32 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-opacity duration-fast data-[state=closed]:opacity-0',
)
export const SelectItem = classPart(
  div,
  'relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const SelectGroup = classPart(div, '')
export const SelectLabel = classPart(div, 'px-2 py-1.5 text-xs font-medium text-muted-foreground')
export const SelectSeparator = classPart(div, '-mx-1 my-1 h-px bg-border')
export const SelectHiddenSelect = classPart(selectEl, 'sr-only')
export const SelectHiddenOption = classPart(option, '')
