import { label as labelEl, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

export const labelRecipe =
  'text-sm font-medium leading-none select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'

/**
 * Label — associate it with a control through `for` (the HTML-native spelling).
 * `htmlFor` is a compile ERROR here: the `attr-name` rule rejects the React-ism
 * because it binds a dead attribute that never associates anything.
 */
export function Label(props: ElProps | undefined, children: readonly ChildNode[] = []): Mountable {
  const { class: className, ...rest } = props ?? {}
  return labelEl({ ...rest, class: mergeClass(labelRecipe, className) }, children)
}
