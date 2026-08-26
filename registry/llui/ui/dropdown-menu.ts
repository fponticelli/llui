import { button, div, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn) with ONE systematic translation, and
 * it is the most important one in this directory:
 *
 *   shadcn:  focus:bg-accent focus:text-accent-foreground
 *   LLui:    data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground
 *
 * Radix moves real DOM focus onto the highlighted menu item, so `focus:` is how
 * shadcn styles it. `@llui/components/menu` keeps focus on the menu CONTENT and
 * tracks the highlight in state, publishing it as `data-highlighted` — which is
 * the accessible pattern (`aria-activedescendant`) and means `focus:` here would
 * never match anything. Every menu-like surface in this registry — dropdown,
 * context menu, menubar, select, combobox, command — carries the same swap.
 *
 * Also dropped: `max-h-(--radix-…-available-height)` and
 * `origin-(--radix-…-transform-origin)`, both written by Radix's positioner.
 *
 * `cursor-default`, not `cursor-pointer`: that is shadcn's choice for menu items
 * and matches native menus.
 */
export const DropdownMenuTrigger = classPart(button, '')
export const DropdownMenuContent = classPart(
  div,
  'z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
)
export const DropdownMenuItem = classPart(
  div,
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
)
export const DropdownMenuCheckboxItem = classPart(
  div,
  "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)
export const DropdownMenuRadioItem = DropdownMenuCheckboxItem
export const DropdownMenuItemIndicator = classPart(
  span,
  'pointer-events-none absolute left-2 flex size-3.5 items-center justify-center',
)
export const DropdownMenuGroup = classPart(div, '')
export const DropdownMenuLabel = classPart(div, 'px-2 py-1.5 text-sm font-medium data-[inset]:pl-8')
export const DropdownMenuSeparator = classPart(div, '-mx-1 my-1 h-px bg-border')
export const DropdownMenuShortcut = classPart(
  span,
  'ml-auto text-xs tracking-widest text-muted-foreground',
)
export const DropdownMenuSubTrigger = classPart(
  div,
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[inset]:pl-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
)
export const DropdownMenuSubContent = classPart(
  div,
  'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
)
