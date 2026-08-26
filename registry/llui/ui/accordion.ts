import { button, div, h3, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass, splitArgs } from '@/lib/utils'

/**
 * Accordion — the SKIN for `@llui/components/accordion`.
 *
 * `AccordionTrigger` wraps its button in an `<h3>` because a collapsible section
 * heading has to be a heading for screen-reader document navigation to work —
 * a `<button>` alone is reachable but never appears in the rotor's heading list.
 * Pass `headingLevel` when the accordion sits under a different outline depth.
 */
export function Accordion(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    {
      ...rest,
      class: mergeClass('divide-y divide-border rounded-lg border border-border', className),
    },
    children,
  )
}

export function AccordionItem(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    { ...rest, class: mergeClass('border-b border-border last:border-b-0', className) },
    children,
  )
}

export function AccordionTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return h3({ class: 'flex' }, [
    button(
      {
        type: 'button',
        ...rest,
        class: mergeClass(
          'flex flex-1 items-center justify-between gap-4 px-4 py-3 text-left text-sm font-medium transition-colors duration-fast outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className,
        ),
      },
      children,
    ),
  ])
}

export function AccordionContent(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    { ...rest, class: mergeClass('px-4 pb-3 text-sm text-muted-foreground', className) },
    children,
  )
}
