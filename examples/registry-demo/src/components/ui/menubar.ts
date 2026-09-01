import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { floatingOverlayMotionRecipe } from '../../lib/floating-motion'

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
} from './dropdown-menu'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with the `focus:` →
 * `data-[highlighted]:` translation `dropdown-menu.ts` explains.
 *
 * The bar and its trigger are unique; dropped panels reuse LLui's adapted
 * dropdown recipes. Restating that policy is how two menus drift apart
 * visually.
 */
export const Menubar = classPart(
  div,
  'flex min-h-9 max-w-full flex-wrap items-center gap-1 overflow-x-auto overscroll-contain rounded-md border bg-background p-1 shadow-xs forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]',
)
export const MenubarTrigger = classPart(
  button,
  'flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground forced-colors:data-[highlighted]:bg-[Highlight] forced-colors:data-[highlighted]:text-[HighlightText] forced-colors:data-[highlighted]:[outline:2px_solid_Highlight] forced-colors:data-[state=open]:[outline:2px_solid_Highlight]',
)
export const MenubarContent = classPart(
  div,
  `z-50 min-w-[12rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto overscroll-contain wrap-break-word rounded-md border bg-popover p-1 text-popover-foreground shadow-md forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] ${floatingOverlayMotionRecipe}`,
)
