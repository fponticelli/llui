import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Floating panel — skin for `@llui/components/floating-panel`. No shadcn
 * counterpart; the surface is the Dialog's vocabulary (`bg-popover`, `border`,
 * `shadow-lg`) because it is the same kind of raised layer.
 *
 * The machine writes position and size as an inline `style` on the root, so
 * this recipe must NOT set any of `top`/`left`/`width`/`height` — an inline
 * style beats a class, so the class would be dead where it matters and win only
 * before the first commit, which is the worst of both.
 *
 * `data-minimized` collapses the panel to its handle: the CONTENT is hidden
 * rather than the root, so the drag handle stays grabbable. Hiding the root
 * would strand a minimized panel with no way to restore it.
 *
 * `touch-none` on the handle and the resize grip is required for pointer drags
 * on touch, exactly as in `sortable`.
 */
export const FloatingPanel = classPart(
  div,
  'fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg data-dragging:select-none data-maximized:rounded-none data-resizing:select-none',
)
export const FloatingPanelDragHandle = classPart(
  div,
  'flex h-9 shrink-0 cursor-grab touch-none items-center gap-2 border-b px-3 text-sm font-medium select-none active:cursor-grabbing',
)
export const FloatingPanelContent = classPart(
  div,
  'min-h-0 flex-1 overflow-auto p-3 text-sm group-data-minimized:hidden',
)
const panelTriggerRecipe =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg:not([class*='size-'])]:size-3.5"
export const FloatingPanelMinimizeTrigger = classPart(button, panelTriggerRecipe)
export const FloatingPanelMaximizeTrigger = classPart(button, panelTriggerRecipe)
export const FloatingPanelCloseTrigger = classPart(button, panelTriggerRecipe)
export const FloatingPanelResizeHandle = classPart(
  div,
  'absolute right-0 bottom-0 size-3 cursor-nwse-resize touch-none',
)
