import { createVariants, type VariantProps } from '../utils/variants.js'

const contentVariants = createVariants({
  base: 'bg-surface border border-border shadow-md overflow-hidden',
  variants: {
    size: {
      sm: 'rounded-md py-1 min-w-32 text-sm',
      md: 'rounded-md py-1 min-w-40',
      lg: 'rounded-lg py-1.5 min-w-48 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const itemVariants = createVariants({
  base: 'flex items-center cursor-pointer transition-colors duration-fast data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2 py-1 text-sm gap-2',
      md: 'px-3 py-1.5 gap-2',
      lg: 'px-4 py-2 text-lg gap-3',
    },
    variant: {
      default: '',
      destructive: 'text-destructive data-[highlighted]:bg-destructive/10',
    },
  },
  defaultVariants: { size: 'md', variant: 'default' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  variant: { default: string; destructive: string }
}

export type MenuStyleVariants = VariantProps<Variants>

export interface MenuClasses {
  trigger: string
  positioner: string
  content: string
  item: string
}

export function menuClasses(props?: MenuStyleVariants): MenuClasses {
  return {
    trigger: '',
    positioner: 'absolute z-popover',
    content: contentVariants(props),
    item: itemVariants(props),
  }
}
