import { div, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). `aria-hidden` is an LLui
 * addition: a loading shape is decoration, and the loading STATE belongs on the
 * region it stands in for. */
export function Skeleton(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    'aria-hidden': 'true',
    class: mergeClass('animate-pulse rounded-md bg-accent', className),
  })
}
