import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex items-center',
  variants: {
    size: {
      sm: 'gap-0.5',
      md: 'gap-1',
      lg: 'gap-1.5',
    },
  },
  defaultVariants: { size: 'md' },
})

const itemVariants = createVariants({
  base: 'cursor-pointer transition-colors duration-fast text-surface-active data-[highlighted]:text-primary data-[state=checked]:text-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'text-lg',
      md: 'text-xl',
      lg: 'text-2xl',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type RatingGroupStyleVariants = VariantProps<Variants>

export interface RatingGroupClasses {
  root: string
  item: string
}

export function ratingGroupClasses(props?: RatingGroupStyleVariants): RatingGroupClasses {
  return {
    root: rootVariants(props),
    item: itemVariants(props),
  }
}
