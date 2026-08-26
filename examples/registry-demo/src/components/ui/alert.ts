import { div, h5, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { createVariants, type VariantProps } from '@llui/components/styles'
import { mergeClass, splitArgs } from '../../lib/utils'

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
  a0?: (ElProps & AlertVariants) | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { variant, class: className, ...rest } = props as ElProps & AlertVariants
  return div(
    { role: 'alert', ...rest, class: mergeClass(alertVariants({ variant }), className) },
    children,
  )
}

export function AlertTitle(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return h5(
    { ...rest, class: mergeClass('mb-1 font-medium leading-none tracking-tight', className) },
    children,
  )
}

export function AlertDescription(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div({ ...rest, class: mergeClass('text-sm [&_p]:leading-relaxed', className) }, children)
}
