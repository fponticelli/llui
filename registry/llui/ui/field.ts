import { div, label, p } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Field — skin for `@llui/components/field`. The package wires `for` / `id` /
 * `aria-describedby` / `aria-invalid` across label, control, description and
 * error, which is the whole reason to reach for it rather than hand-rolling a
 * labelled input.
 */
export const Field = classPart(div, 'flex flex-col gap-2')
export const FieldLabel = classPart(
  label,
  'text-sm leading-none font-medium select-none data-[disabled]:opacity-70',
)
export const FieldDescription = classPart(p, 'text-sm text-muted-foreground')
export const FieldError = classPart(p, 'text-sm font-medium text-destructive')
export const FieldGroup = classPart(div, 'flex flex-col gap-4')
