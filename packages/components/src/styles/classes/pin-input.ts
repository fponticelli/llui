import { createVariants, type VariantProps } from '../utils/variants'

const inputVariants = createVariants({
  base: 'text-center border border-border bg-surface outline-none transition-all duration-fast focus:border-border-focus data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-8 h-8 text-sm rounded-md',
      md: 'w-10 h-10 rounded-md',
      lg: 'w-12 h-12 text-lg rounded-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type PinInputStyleVariants = VariantProps<Variants>

export interface PinInputClasses {
  root: string
  label: string
  input: string
}

export function pinInputClasses(props?: PinInputStyleVariants): PinInputClasses {
  return {
    root: 'inline-flex items-center gap-2',
    label: 'font-medium text-text',
    input: inputVariants(props),
  }
}
