import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'flex items-center gap-1',
  variants: {
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col items-stretch',
    },
    size: {
      sm: 'p-0.5',
      md: 'p-1',
      lg: 'p-1.5',
    },
  },
  defaultVariants: { orientation: 'horizontal', size: 'md' },
})

const separatorVariants = createVariants({
  base: 'bg-border shrink-0',
  variants: {
    orientation: {
      horizontal: 'w-px self-stretch mx-1',
      vertical: 'h-px self-stretch my-1',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

type Variants = {
  orientation: { horizontal: string; vertical: string }
  size: { sm: string; md: string; lg: string }
}

export type ToolbarStyleVariants = VariantProps<Variants>

export interface ToolbarClasses {
  root: string
  group: string
  separator: string
  item: string
}

export function toolbarClasses(props?: ToolbarStyleVariants): ToolbarClasses {
  return {
    root: rootVariants(props),
    group: 'flex items-center gap-1',
    separator: separatorVariants(props),
    item: 'inline-flex items-center justify-center',
  }
}
