import {
  div,
  fieldset,
  label,
  legend,
  p,
  ul,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { classPart, createVariantsPart, mergeClass, splitArgs } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten
 * to LLui's `data-part`.
 *
 * `@llui/components/field` wires `for` / `id` / `aria-describedby` /
 * `aria-invalid` across label, control, description and error — the whole reason
 * to reach for it rather than hand-rolling a labelled input.
 *
 * Two things carry the layout and must not be dropped:
 *
 *  - **`orientation`.** `vertical` stacks, `horizontal` puts the label beside the
 *    control, and `responsive` switches between them at the `@md` CONTAINER
 *    breakpoint of the enclosing `FieldGroup` — which is why `FieldGroup`
 *    declares `@container/field-group`. Without that container the responsive
 *    variant silently behaves as vertical at every width.
 *  - **The `group/…` names** (`group/field`, `group/field-content`,
 *    `group/field-label`, `peer/field-label`). `data-[invalid=true]` and
 *    `data-[disabled=true]` are set on the ROOT and read by descendants through
 *    them, so renaming one turns off every rule keyed to it with no error.
 */
export const FieldSet = classPart(
  fieldset,
  'flex flex-col gap-6 has-[>[data-part=checkbox-group]]:gap-3 has-[>[data-part=radio-group]]:gap-3',
)
export const FieldLegend = createVariantsPart(legend, {
  base: 'mb-3 font-medium',
  variants: { variant: { legend: 'text-base', label: 'text-sm' } },
  defaultVariants: { variant: 'legend' },
})
export const FieldGroup = classPart(
  div,
  'group/field-group @container/field-group flex w-full flex-col gap-7 data-[part=checkbox-group]:gap-3 [&>[data-part=field-group]]:gap-4',
)

export const Field = createVariantsPart(div, {
  base: 'group/field flex w-full gap-3 data-[invalid=true]:text-destructive',
  variants: {
    orientation: {
      vertical: 'flex-col [&>*]:w-full [&>.sr-only]:w-auto',
      horizontal:
        'flex-row items-center [&>[data-part=field-label]]:flex-auto has-[>[data-part=field-content]]:items-start has-[>[data-part=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      responsive:
        'flex-col @md/field-group:flex-row @md/field-group:items-center [&>*]:w-full @md/field-group:[&>*]:w-auto [&>.sr-only]:w-auto @md/field-group:[&>[data-part=field-label]]:flex-auto @md/field-group:has-[>[data-part=field-content]]:items-start @md/field-group:has-[>[data-part=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
    },
  },
  defaultVariants: { orientation: 'vertical' },
})

export const FieldContent = classPart(
  div,
  'group/field-content flex flex-1 flex-col gap-1.5 leading-snug',
)
export const FieldLabel = classPart(
  label,
  'group/field-label peer/field-label flex w-fit gap-2 leading-snug text-sm font-medium select-none group-data-[disabled=true]/field:opacity-50 has-[>[data-part=field]]:w-full has-[>[data-part=field]]:flex-col has-[>[data-part=field]]:rounded-md has-[>[data-part=field]]:border [&>*]:data-[part=field]:p-4 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 dark:has-data-[state=checked]:bg-primary/10',
)
export const FieldTitle = classPart(
  div,
  'flex w-fit items-center gap-2 text-sm leading-snug font-medium group-data-[disabled=true]/field:opacity-50',
)
export const FieldDescription = classPart(
  p,
  'text-sm leading-normal font-normal text-muted-foreground group-has-[[data-orientation=horizontal]]/field:text-balance last:mt-0 nth-last-2:-mt-1 [[data-variant=legend]+&]:-mt-1.5 [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
)

/**
 * A rule with optional centred content. The `absolute inset-0 top-1/2` line and
 * the `relative … bg-background px-2` label are what make the text sit ON the
 * rule rather than beside it.
 */
export function FieldSeparator(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div(
    {
      'data-part': 'field-separator',
      ...rest,
      class: mergeClass(
        'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
        className,
      ),
    },
    [
      div({
        'data-part': 'field-separator-rule',
        class: 'absolute inset-0 top-1/2 h-px bg-border',
      }),
      ...(children.length > 0
        ? [
            div(
              {
                'data-part': 'field-separator-content',
                class: 'relative mx-auto block w-fit bg-background px-2 text-muted-foreground',
              },
              children,
            ),
          ]
        : []),
    ],
  )
}

export const FieldError = classPart(p, 'text-sm font-normal text-destructive')
/** shadcn renders multiple validation messages as a disc list. */
export const FieldErrorList = classPart(ul, 'ml-4 flex list-disc flex-col gap-1')
