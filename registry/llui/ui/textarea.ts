import { textarea as textareaEl, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const textareaRecipe =
  'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40'

/** Textarea — same caller-owns-the-value contract as {@link Input}. */
export function Textarea(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return textareaEl({ ...rest, class: mergeClass(textareaRecipe, className) })
}
