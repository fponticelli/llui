import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass, splitArgs } from '@/lib/utils'

/**
 * Popover — the SKIN for `@llui/components/popover`. Floating placement,
 * dismissal, nested-layer ownership and focus restoration are the package's.
 *
 * The floating wrapper is built by `overlay()` itself, so its class — the
 * `z-index` for the layer — is passed as `positionerClass: 'z-popover'` rather
 * than by wrapping a part bag.
 *
 * `data-side` comes from the positioner, so the enter animation is written as a
 * `data-[side=…]:` variant rather than computed in a view.
 */
export function PopoverContent(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    {
      ...rest,
      class: mergeClass(
        'w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none transition-all duration-fast data-[state=closed]:opacity-0 data-[side=bottom]:data-[state=closed]:-translate-y-1 data-[side=top]:data-[state=closed]:translate-y-1',
        className,
      ),
    },
    children,
  )
}

export function PopoverArrow(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    class: mergeClass('size-2.5 rotate-45 border border-border bg-popover', className),
  })
}
