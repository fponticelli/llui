import { div, h5, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { createVariants, type VariantProps } from '@llui/components/styles'
import { mergeClass } from '@/lib/utils'

const variants = {
  variant: {
    default: 'bg-card text-card-foreground',
    destructive: 'border-destructive/50 text-destructive',
  },
}

export const alertVariants = createVariants({
  base: 'relative w-full rounded-lg border border-border px-4 py-3 text-sm',
  variants,
  defaultVariants: { variant: 'default' },
})

export type AlertVariants = VariantProps<typeof variants>

/**
 * Alert — `role="alert"` on the ROOT is deliberate and is what makes this an
 * alert rather than a coloured box: assistive tech announces the subtree when it
 * is inserted. It is applied before the caller's spread, so a caller wiring a
 * `status`/`log` live region instead can override it.
 */
export function Alert(
  props: (ElProps & AlertVariants) | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { variant, class: className, ...rest } = props ?? {}
  return div(
    { role: 'alert', ...rest, class: mergeClass(alertVariants({ variant }), className) },
    children,
  )
}

export function AlertTitle(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return h5(
    { ...rest, class: mergeClass('mb-1 font-medium leading-none tracking-tight', className) },
    children,
  )
}

export function AlertDescription(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({ ...rest, class: mergeClass('text-sm [&_p]:leading-relaxed', className) }, children)
}
