import { span, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { createVariants, type VariantProps } from '@llui/components/styles'
import { mergeClass, splitArgs } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * The `[a&]:hover:` prefixes mean "when this element is also an `<a>`" — a badge
 * is not interactive unless it is a link, so the hover states are scoped to that
 * case rather than applied unconditionally.
 */
const variants = {
  variant: {
    default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
    destructive:
      'bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90',
    outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
  },
}

export const badgeVariants = createVariants({
  base: 'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  variants,
  defaultVariants: { variant: 'default' },
})

export type BadgeVariants = VariantProps<typeof variants>

export function Badge(
  a0?: (ElProps & BadgeVariants) | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { variant, class: className, ...rest } = props as ElProps & BadgeVariants
  return span({ ...rest, class: mergeClass(badgeVariants({ variant }), className) }, children)
}
