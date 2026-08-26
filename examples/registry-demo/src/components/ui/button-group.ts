import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'

/**
 * ButtonGroup — segments adjacent buttons into one control by collapsing the
 * shared borders and rounding only the outer corners. `role="group"` is applied
 * before the spread so a caller can name it `radiogroup` or `toolbar` instead.
 *
 * The `[&>*:not(:first-child)]` selectors do the work rather than a class on each
 * child, so the group stays correct when children are added or reordered.
 */
export function ButtonGroup(
  a0?: (ElProps & { orientation?: 'horizontal' | 'vertical' }) | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const {
    orientation = 'horizontal',
    class: className,
    ...rest
  } = props as ElProps & { orientation?: 'horizontal' | 'vertical' }
  const shape =
    orientation === 'horizontal'
      ? 'flex-row [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:-ml-px [&>*:not(:last-child)]:rounded-r-none'
      : 'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:-mt-px [&>*:not(:last-child)]:rounded-b-none'
  return div(
    {
      role: 'group',
      ...rest,
      'data-orientation': orientation,
      class: mergeClass(`inline-flex items-center ${shape}`, className),
    },
    children,
  )
}

/** A non-interactive segment — a label or count wedged into the group. */
export const ButtonGroupText = classPart(
  div,
  'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-4 text-sm font-medium',
)

export const ButtonGroupSeparator = classPart(div, 'w-px self-stretch bg-border')
