import { div, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Toolbar — skin for `@llui/components/toolbar`. No shadcn equivalent; the
 * package supplies `role="toolbar"` roving focus across groups. */
export const Toolbar = classPart(
  div,
  'flex items-center gap-1 rounded-md border border-border bg-background p-1 shadow-sm data-[orientation=vertical]:flex-col',
)
export const ToolbarGroup = classPart(div, 'flex items-center gap-1')
export const ToolbarGroupLabel = classPart(span, 'px-1 text-xs text-muted-foreground')
export const ToolbarSeparator = classPart(
  div,
  'mx-1 w-px self-stretch bg-border data-[orientation=vertical]:mx-0 data-[orientation=vertical]:my-1 data-[orientation=vertical]:h-px data-[orientation=vertical]:w-auto',
)
