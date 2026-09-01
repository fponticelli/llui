import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { floatingOverlayMotionRecipe } from '@/lib/floating-motion'

export {
  DropdownMenuGroup as MenubarGroup,
  DropdownMenuItem as MenubarItem,
  DropdownMenuCheckboxItem as MenubarCheckboxItem,
  DropdownMenuRadioItem as MenubarRadioItem,
  DropdownMenuItemIndicator as MenubarItemIndicator,
  DropdownMenuLabel as MenubarLabel,
  DropdownMenuSeparator as MenubarSeparator,
  DropdownMenuShortcut as MenubarShortcut,
  DropdownMenuSubContent as MenubarSubContent,
  DropdownMenuSubTrigger as MenubarSubTrigger,
} from '@/ui/dropdown-menu'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with the `focus:` →
 * `data-[highlighted]:` translation `dropdown-menu.ts` explains.
 *
 * The bar and its trigger are unique; the dropped panels re-export the dropdown
 * recipes because shadcn's are byte-identical between the two. Restating them
 * is how two menus drift apart visually.
 */
export const Menubar = classPart(
  div,
  'flex h-9 items-center gap-1 rounded-md border bg-background p-1 shadow-xs',
)
export const MenubarTrigger = classPart(
  button,
  'flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
)
export const MenubarContent = classPart(
  div,
  `z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md ${floatingOverlayMotionRecipe}`,
)
