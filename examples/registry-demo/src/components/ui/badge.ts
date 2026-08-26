import { span, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { createVariants, type VariantProps } from '@llui/components/styles'
import { mergeClass, splitArgs } from '../../lib/utils'

const variants = {
  variant: {
    default:
      'border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
    secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-accent-strong',
    destructive:
      'border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover',
    outline: 'text-foreground',
  },
}

export const badgeVariants = createVariants({
  base: 'inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
