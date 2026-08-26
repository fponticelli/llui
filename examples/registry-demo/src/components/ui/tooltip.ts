import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass, splitArgs } from '../../lib/utils'

/** Tooltip — the SKIN for `@llui/components/tooltip`. Open/close delays, pointer
 * and focus triggers, and dismissal live in the package. Pass
 * `positionerClass: 'z-tooltip'` to `overlay()` for the floating layer's z-index. */
export function TooltipContent(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    {
      ...rest,
      class: mergeClass(
        'w-fit rounded-md bg-primary px-3 py-1.5 text-xs text-balance text-primary-foreground shadow-md transition-opacity duration-fast data-[state=closed]:opacity-0',
        className,
      ),
    },
    children,
  )
}

export function TooltipArrow(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({ ...rest, class: mergeClass('size-2.5 rotate-45 bg-primary', className) })
}
