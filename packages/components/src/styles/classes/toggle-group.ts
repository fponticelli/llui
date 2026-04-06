import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex border border-border rounded-md overflow-hidden',
  variants: {
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

const itemVariants = createVariants({
  base: 'inline-flex items-center justify-center bg-surface cursor-pointer transition-all duration-fast hover:bg-surface-hover data-[state=on]:bg-surface-active data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed border-r border-border last:border-r-0',
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
  orientation: { horizontal: string; vertical: string }
}

export type ToggleGroupStyleVariants = VariantProps<Variants>

export interface ToggleGroupClasses {
  root: string
  item: string
}

export function toggleGroupClasses(props?: ToggleGroupStyleVariants): ToggleGroupClasses {
  return {
    root: rootVariants(props),
    item: itemVariants(props),
  }
}
