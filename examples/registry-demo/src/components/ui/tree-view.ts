import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** TreeView — skin for `@llui/components/tree-view`. No shadcn equivalent; the
 * package supplies full `role="tree"` keyboard navigation and optional
 * tri-state checkboxes. `data-level` drives the indent. */
export const TreeView = classPart(div, 'flex flex-col gap-0.5 text-sm')
export const TreeViewItem = classPart(
  div,
  'flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 outline-none select-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[selected]:bg-accent data-[selected]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const TreeViewBranchTrigger = classPart(
  button,
  'inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-transform data-[state=open]:rotate-90',
)
export const TreeViewCheckbox = classPart(
  div,
  'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
)
