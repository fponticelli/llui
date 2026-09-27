import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'

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
 * would strand a minimized panel with no way to restore it. The content reads
 * the root's state through the NAMED `group/floating-panel` — an unnamed
 * `group-data-minimized:` had no `group` marker to match (#266).
 *
 * `touch-none` on the handle and the resize grips is required for pointer drags
 * on touch, exactly as in `sortable`. Both are keyboard stops as well (arrows
 * move the panel from the handle and resize from a grip), so both carry a
 * focus ring. Each grip is placed by its `data-handle` — physical edges, like
 * the physical `left`/`top` geometry they resize. The window toggles publish
 * `aria-pressed`, which is also their "on" styling hook.
 */
export const FloatingPanel = classPart(
  div,
  'group/floating-panel fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg data-dragging:select-none data-maximized:rounded-none data-resizing:select-none',
)
export const FloatingPanelDragHandle = classPart(
  div,
  'flex h-9 shrink-0 cursor-grab touch-none items-center gap-2 border-b px-3 text-sm font-medium outline-none select-none active:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring/50 group-data-minimized/floating-panel:border-transparent',
)
export const FloatingPanelContent = classPart(
  div,
  'min-h-0 flex-1 overflow-auto p-3 text-sm group-data-minimized/floating-panel:hidden',
)
const panelTriggerRecipe =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-accent-foreground [&_svg:not([class*='size-'])]:size-3.5"
export const FloatingPanelMinimizeTrigger = classPart(button, panelTriggerRecipe)
export const FloatingPanelMaximizeTrigger = classPart(button, panelTriggerRecipe)
export const FloatingPanelCloseTrigger = classPart(button, panelTriggerRecipe)
export const FloatingPanelResizeHandle = classPart(
  div,
  'absolute touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-data-maximized/floating-panel:hidden data-[handle=e]:inset-y-3 data-[handle=e]:right-0 data-[handle=e]:w-1.5 data-[handle=e]:cursor-ew-resize data-[handle=n]:inset-x-3 data-[handle=n]:top-0 data-[handle=n]:h-1.5 data-[handle=n]:cursor-ns-resize data-[handle=ne]:top-0 data-[handle=ne]:right-0 data-[handle=ne]:size-3 data-[handle=ne]:cursor-nesw-resize data-[handle=nw]:top-0 data-[handle=nw]:left-0 data-[handle=nw]:size-3 data-[handle=nw]:cursor-nwse-resize data-[handle=s]:inset-x-3 data-[handle=s]:bottom-0 data-[handle=s]:h-1.5 data-[handle=s]:cursor-ns-resize data-[handle=se]:right-0 data-[handle=se]:bottom-0 data-[handle=se]:size-3 data-[handle=se]:cursor-nwse-resize data-[handle=sw]:bottom-0 data-[handle=sw]:left-0 data-[handle=sw]:size-3 data-[handle=sw]:cursor-nesw-resize data-[handle=w]:inset-y-3 data-[handle=w]:left-0 data-[handle=w]:w-1.5 data-[handle=w]:cursor-ew-resize',
)
