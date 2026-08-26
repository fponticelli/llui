import { div, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

export function Skeleton(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    'aria-hidden': 'true',
    class: mergeClass('animate-pulse rounded-md bg-accent', className),
  })
}
