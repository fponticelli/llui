import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'

export {
  DropdownMenuContent as MenubarContent,
  DropdownMenuGroup as MenubarGroup,
  DropdownMenuItem as MenubarItem,
  DropdownMenuLabel as MenubarLabel,
  DropdownMenuSeparator as MenubarSeparator,
  DropdownMenuShortcut as MenubarShortcut,
  DropdownMenuSubContent as MenubarSubContent,
  DropdownMenuSubTrigger as MenubarSubTrigger,
} from '@/ui/dropdown-menu'

/** Menubar — skin for `@llui/components/menubar`. The bar itself is unique; the
 * dropped panels reuse the dropdown recipes. */
export const Menubar = classPart(
  div,
  'flex h-9 items-center gap-1 rounded-md border border-border bg-background p-1 shadow-sm',
)
export const MenubarTrigger = classPart(
  button,
  'flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
)
