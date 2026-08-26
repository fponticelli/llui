import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/** Tooltip — the SKIN for `@llui/components/tooltip`. Open/close delays, pointer
 * and focus triggers, and dismissal live in the package. */
export function TooltipPositioner(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({ ...rest, class: mergeClass('z-tooltip', className) }, children)
}

export function TooltipContent(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
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
  return div({ ...rest, class: mergeClass('size-2 rotate-45 bg-primary', className) })
}
