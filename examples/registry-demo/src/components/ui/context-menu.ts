import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { overlayReducedMotionRecipe } from '../../lib/floating-motion'

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
  DropdownMenuSubPositioner as ContextMenuSubPositioner,
} from './dropdown-menu'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). The item/label/separator/submenu
 * recipes intentionally reuse LLui's adapted dropdown policy rather than
 * restating it; only the content's shadow differs (`shadow-lg`).
 *
 * `context-menu` is anchorless for geometry, but it is not unowned: the machine
 * captures the actual region that dispatched the `contextmenu` event and uses
 * that element as its nested-layer owner for the visible interaction phase.
 * Closing unwinds modal/dismiss/focus ownership immediately and clears that owner
 * even when animated content remains mounted; a later programmatic `openAt`
 * deliberately has no event owner and therefore fails closed inside a modal.
 */
export const ContextMenuContent = classPart(
  div,
  `z-50 min-w-[8rem] max-w-[calc(100vw-2rem)] max-h-[var(--llui-floating-available-height,calc(100dvh-2rem))] overflow-x-hidden overflow-y-auto overscroll-contain wrap-break-word rounded-md border bg-popover p-1 text-popover-foreground shadow-lg forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] data-[state=opening]:animate-in data-[state=opening]:fade-in-0 data-[state=opening]:zoom-in-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closing]:animate-out data-[state=closing]:fade-out-0 data-[state=closing]:zoom-out-95 ${overlayReducedMotionRecipe}`,
)
