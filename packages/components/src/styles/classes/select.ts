import { createVariants, type VariantProps } from '../utils/variants'

const triggerVariants = createVariants({
  base: 'inline-flex items-center justify-between bg-surface border border-border cursor-pointer transition-all duration-fast hover:border-border-hover data-[state=open]:border-border-focus data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2.5 py-1.5 text-sm rounded-md gap-1.5',
      md: 'px-3 py-2 rounded-md gap-2',
      lg: 'px-4 py-2.5 text-lg rounded-lg gap-2.5',
    },
  },
  defaultVariants: { size: 'md' },
})

const contentVariants = createVariants({
  base: 'bg-surface border border-border shadow-md overflow-auto',
  variants: {
    size: {
      sm: 'rounded-md py-1 text-sm',
      md: 'rounded-md py-1',
      lg: 'rounded-lg py-1.5 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const itemVariants = createVariants({
  base: 'flex items-center cursor-pointer transition-colors duration-fast data-[highlighted]:bg-surface-hover data-[state=checked]:text-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2 py-1 text-sm',
      md: 'px-3 py-1.5',
      lg: 'px-4 py-2 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type SelectStyleVariants = VariantProps<Variants>

export interface SelectClasses {
  trigger: string
  positioner: string
  content: string
  item: string
  hiddenSelect: string
}

export function selectClasses(props?: SelectStyleVariants): SelectClasses {
  return {
    trigger: triggerVariants(props),
    positioner: 'absolute z-popover',
    content: contentVariants(props),
    item: itemVariants(props),
    hiddenSelect: 'sr-only',
  }
}
