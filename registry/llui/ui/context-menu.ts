import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

export {
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuCheckboxItem as ContextMenuCheckboxItem,
  DropdownMenuRadioItem as ContextMenuRadioItem,
  DropdownMenuItemIndicator as ContextMenuItemIndicator,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
  DropdownMenuSubContent as ContextMenuSubContent,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
} from '@/ui/dropdown-menu'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). The item/label/separator/submenu
 * recipes are byte-identical to the dropdown's upstream, so they are re-exported
 * rather than restated; only the content's shadow differs (`shadow-lg`).
 *
 * `context-menu` is anchorless by design, so its overlay registers UNOWNED in
 * the nested-layer registry — see llui issue #215 before nesting one in a modal.
 */
export const ContextMenuContent = classPart(
  div,
  'z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
)
