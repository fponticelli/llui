import { label as labelEl, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass, splitArgs } from '../../lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const labelRecipe =
  'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50'

/**
 * Label — associate it with a control through `for` (the HTML-native spelling).
 * `htmlFor` is a compile ERROR here: the `attr-name` rule rejects the React-ism,
 * which binds a dead attribute that associates nothing.
 */
export function Label(a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return labelEl({ ...rest, class: mergeClass(labelRecipe, className) }, children)
}
