import { button, div, input, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** TagsInput — skin for `@llui/components/tags-input`. No shadcn equivalent. */
export const TagsInput = classPart(
  div,
  'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-sm shadow-sm transition-colors duration-fast focus-within:ring-2 focus-within:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
)
export const TagsInputTag = classPart(
  span,
  'inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
)
export const TagsInputTagRemove = classPart(
  button,
  'text-muted-foreground transition-colors duration-fast hover:text-foreground',
)
export const TagsInputControl = classPart(
  input,
  'h-6 min-w-24 flex-1 border-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground',
)
export const TagsInputClear = classPart(
  button,
  'text-muted-foreground transition-colors duration-fast hover:text-foreground',
)
