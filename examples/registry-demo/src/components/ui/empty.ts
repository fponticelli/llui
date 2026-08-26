import { div, h3, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, splitArgs, mergeClass } from '../../lib/utils'

/**
 * Empty — the "nothing here yet" state. Parts rather than one component because
 * the useful version always carries a title, a line of explanation and an
 * action, and each of those wants its own overrides.
 */
export function Empty(a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div(
    {
      ...rest,
      class: mergeClass(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center',
        className,
      ),
    },
    children,
  )
}

export const EmptyMedia = classPart(
  div,
  'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
)
export const EmptyTitle = classPart(h3, 'text-sm font-medium')
export const EmptyDescription = classPart(p, 'text-sm text-muted-foreground text-balance')
export const EmptyContent = classPart(div, 'flex w-full max-w-sm flex-col items-center gap-2')
