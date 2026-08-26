import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, createVariantsPart, splitArgs } from '../../lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * `border-l-0` on every child but the first — not a negative margin. That is
 * shadcn's approach and it matters: `-ml-px` overlaps the borders and leaves a
 * doubled edge visible at some zoom levels, while dropping the border removes
 * it outright.
 */
const group = createVariantsPart(div, {
  base: "flex w-fit items-stretch has-[>[data-part=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 [&>[data-part=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  variants: {
    orientation: {
      horizontal:
        '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none',
      vertical:
        'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

export function ButtonGroup(
  a0?: (ElProps & { orientation?: 'horizontal' | 'vertical' }) | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const bag = props as ElProps & { orientation?: 'horizontal' | 'vertical' }
  return group(
    { role: 'group', 'data-orientation': bag.orientation ?? 'horizontal', ...bag },
    children,
  )
}

/** A non-interactive segment — a label or count wedged into the group. */
export const ButtonGroupText = classPart(
  div,
  "flex items-center gap-2 rounded-md border bg-muted px-4 text-sm font-medium shadow-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
)
export const ButtonGroupSeparator = classPart(
  div,
  'relative m-0! self-stretch w-px bg-input data-[orientation=vertical]:h-auto',
)
