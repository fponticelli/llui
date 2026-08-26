import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass, splitArgs } from '../../lib/utils'

/** AspectRatio — constrains children to a ratio using the native `aspect-ratio`
 * property. `ratio` is a Tailwind fraction (`16/9`), passed through as an
 * arbitrary value so any ratio works without adding a token. */
export function AspectRatio(
  a0?: (ElProps & { ratio?: string }) | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { ratio = '16/9', class: className, ...rest } = props as ElProps & { ratio?: string }
  return div(
    {
      ...rest,
      class: mergeClass('w-full overflow-hidden', className),
      'style.aspect-ratio': ratio,
    },
    children,
  )
}
