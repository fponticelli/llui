import { button, div, h3 } from '@llui/dom'
import { type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '@/lib/utils'
import { ChevronDownIcon } from '@/ui/icons'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * `AccordionTrigger` wraps its button in an `<h3>` because a collapsible section
 * heading has to be a heading for screen-reader document navigation — a
 * `<button>` alone is reachable but never appears in the rotor's heading list.
 * shadcn uses `AccordionPrimitive.Header` for the same reason.
 *
 * The content animates with `animate-accordion-up`/`-down`, whose keyframes ship
 * in `@llui/components/styles/tokens.css`. They read `--content-height`; set it
 * on the content element for a height transition, or leave it for `auto`.
 */
export const Accordion = classPart(div, '')
export const AccordionItem = classPart(div, 'border-b last:border-b-0')

export function AccordionTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return h3({ class: 'flex' }, [
    button(
      {
        type: 'button',
        ...rest,
        class: mergeClass(
          'flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&[data-state=open]>svg]:rotate-180',
          className,
        ),
      },
      [
        ...children,
        ChevronDownIcon({
          class:
            'pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200',
        }),
      ],
    ),
  ])
}

export const AccordionContent = classPart(
  div,
  'overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down',
)
/** The inner padding shadcn puts on a nested div, kept as its own part so the
 * animated height wrapper stays padding-free (padding on an animating element
 * makes the collapse jump). */
export const AccordionContentInner = classPart(div, 'pt-0 pb-4')
