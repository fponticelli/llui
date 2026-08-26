import { input as inputEl, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). See `button.ts` for the
 * shared idioms these recipes rely on. */
export const inputRecipe =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40'

/**
 * Input — the caller owns the value binding.
 *
 * LLui does NOT bind `value` for you, and must not: the `controlled-input`
 * compiler rule is a build ERROR on an `input` with a reactive `value` and no
 * `onInput`/`onChange`, because the binding would overwrite every keystroke.
 */
export function Input(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return inputEl({ ...rest, class: mergeClass(inputRecipe, className) })
}
