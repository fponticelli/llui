import { input as inputEl, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

export const inputRecipe =
  'flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors duration-fast file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive'

/**
 * Input — the caller owns the value binding.
 *
 * LLui does NOT bind `value` for you, and must not: the `controlled-input`
 * compiler rule is a build ERROR on an `input` with a reactive `value` and no
 * `onInput`/`onChange`, because the binding would overwrite every keystroke.
 * Pass both, or neither.
 */
export function Input(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return inputEl({ ...rest, class: mergeClass(inputRecipe, className) })
}
