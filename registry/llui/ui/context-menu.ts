export {
  DropdownMenuContent as ContextMenuContent,
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
  DropdownMenuSubContent as ContextMenuSubContent,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
} from '@/ui/dropdown-menu'

/**
 * ContextMenu — skin for `@llui/components/context-menu`.
 *
 * Deliberately re-exports the dropdown recipes rather than restating them: the
 * two differ only in what OPENS them (a right-click vs a trigger button), and
 * `menu-machine.ts` gives them the same parts. Duplicating the recipes is how
 * two menus drift apart visually.
 *
 * Note that `context-menu` is anchorless by design, so its overlay registers
 * UNOWNED in the nested-layer registry — see llui issue #215 before nesting one
 * inside a modal.
 */
