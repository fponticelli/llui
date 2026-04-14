import { createVariants, type VariantProps } from '../utils/variants.js'

const contentVariants = createVariants({
  base: 'bg-text text-text-inverted shadow-md px-2.5 py-1.5',
  variants: {
    size: {
      sm: 'rounded-md text-xs max-w-48',
      md: 'rounded-md text-sm max-w-64',
      lg: 'rounded-lg max-w-80',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TooltipStyleVariants = VariantProps<Variants>

export interface TooltipClasses {
  trigger: string
  positioner: string
  content: string
  arrow: string
}

export function tooltipClasses(props?: TooltipStyleVariants): TooltipClasses {
  return {
    trigger: '',
    positioner: 'absolute z-tooltip',
    content: contentVariants(props),
    arrow: 'fill-text',
  }
}
