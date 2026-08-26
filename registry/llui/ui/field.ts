import { div, label, p } from '@llui/dom'
import { classPart, createVariantsPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * `@llui/components/field` wires `for` / `id` / `aria-describedby` /
 * `aria-invalid` across label, control, description and error — the whole
 * reason to reach for it rather than hand-rolling a labelled input. The
 * `group/field` name is what lets `data-[invalid=true]` on the root tint the
 * label and description together.
 */
export const Field = classPart(
  div,
  'group/field flex w-full gap-3 data-[invalid=true]:text-destructive has-[>[data-part=radio-group]]:gap-3',
)
export const FieldGroup = classPart(
  div,
  'group/field-group @container/field-group flex w-full flex-col gap-7 [&>[data-part=field-group]]:gap-4',
)
export const FieldLabel = createVariantsPart(label, {
  base: 'flex items-center gap-2 leading-snug font-medium select-none group-data-[disabled=true]/field:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
  variants: { variant: { label: 'data-[variant=label]:text-sm text-sm', legend: 'text-base' } },
  defaultVariants: { variant: 'label' },
})
export const FieldDescription = classPart(
  p,
  'text-sm leading-normal font-normal text-muted-foreground group-has-[[data-orientation=horizontal]]/field:text-balance',
)
export const FieldError = classPart(p, 'text-sm font-normal text-destructive')
export const FieldSeparator = classPart(
  div,
  'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
)
