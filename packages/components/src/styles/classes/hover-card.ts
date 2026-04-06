import { createVariants, type VariantProps } from '../utils/variants'

const contentVariants = createVariants({
  base: 'bg-surface border border-border shadow-lg p-4',
  variants: {
    size: {
      sm: 'rounded-md max-w-56 text-sm',
      md: 'rounded-lg max-w-72',
      lg: 'rounded-xl max-w-96 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type HoverCardStyleVariants = VariantProps<Variants>

export interface HoverCardClasses {
  trigger: string
  positioner: string
  content: string
  arrow: string
}

export function hoverCardClasses(props?: HoverCardStyleVariants): HoverCardClasses {
  return {
    trigger: '',
    positioner: 'absolute z-popover',
    content: contentVariants(props),
    arrow: 'fill-surface stroke-border',
  }
}
