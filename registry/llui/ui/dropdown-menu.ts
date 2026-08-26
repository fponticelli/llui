import { button, div, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * DropdownMenu — skin for `@llui/components/menu`. Roving focus, typeahead,
 * submenus and dismissal are the package's; pass the content's z-index to
 * `overlay()` as `positionerClass: 'z-popover'`.
 *
 * `menu-machine.ts` supplies the item/group/separator/submenu parts shared with
 * `context-menu` and `menubar`, so these recipes are reused by all three.
 */
export const DropdownMenuTrigger = classPart(
  button,
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring',
)
export const DropdownMenuContent = classPart(
  div,
  'min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-opacity duration-fast data-[state=closed]:opacity-0',
)
export const DropdownMenuItem = classPart(
  div,
  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
)
export const DropdownMenuGroup = classPart(div, '')
export const DropdownMenuLabel = classPart(div, 'px-2 py-1.5 text-sm font-medium')
export const DropdownMenuSeparator = classPart(div, '-mx-1 my-1 h-px bg-border')
export const DropdownMenuShortcut = classPart(
  span,
  'ml-auto text-xs tracking-widest text-muted-foreground',
)
export const DropdownMenuSubTrigger = classPart(
  div,
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent',
)
export const DropdownMenuSubContent = classPart(
  div,
  'min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg',
)
