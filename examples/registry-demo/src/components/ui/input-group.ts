import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'

/**
 * InputGroup — an input with an icon, prefix, suffix or button fused to it.
 *
 * The group owns the border and focus ring; the inner control gives them up
 * (`border-0 shadow-none focus-visible:ring-0`), which is why the recipe reaches
 * into `[&>input]` rather than asking the caller to pass a stripped Input. A
 * focus ring drawn on the inner control would sit INSIDE the group's border.
 */
export function InputGroup(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div(
    {
      ...rest,
      class: mergeClass(
        'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-transparent px-3 shadow-sm transition-colors duration-fast focus-within:ring-2 focus-within:ring-ring has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 [&>input]:h-full [&>input]:w-full [&>input]:border-0 [&>input]:bg-transparent [&>input]:p-0 [&>input]:shadow-none [&>input]:outline-none [&>input]:focus-visible:ring-0',
        className,
      ),
    },
    children,
  )
}

export const InputGroupAddon = classPart(
  div,
  'flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground [&_svg]:size-4',
)
export const InputGroupText = classPart(div, 'shrink-0 text-sm text-muted-foreground')
