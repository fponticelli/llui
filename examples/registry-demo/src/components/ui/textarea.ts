import { textarea as textareaEl, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '../../lib/utils'

export const textareaRecipe =
  'flex min-h-16 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm transition-colors duration-fast placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive'

/** Textarea — same caller-owns-the-value contract as {@link Input}. */
export function Textarea(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return textareaEl({ ...rest, class: mergeClass(textareaRecipe, className) })
}
