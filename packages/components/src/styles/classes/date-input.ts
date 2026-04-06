import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex items-center border border-border bg-surface transition-all duration-fast focus-within:border-border-focus',
  variants: {
    size: {
      sm: 'rounded-md h-8 px-2 text-sm gap-1',
      md: 'rounded-md h-10 px-3 gap-1',
      lg: 'rounded-lg h-12 px-4 text-lg gap-1.5',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type DateInputStyleVariants = VariantProps<Variants>

export interface DateInputClasses {
  root: string
  input: string
  clearTrigger: string
  errorText: string
}

export function dateInputClasses(props?: DateInputStyleVariants): DateInputClasses {
  return {
    root: rootVariants(props),
    input: 'bg-transparent border-none outline-none text-center w-8',
    clearTrigger: 'cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    errorText: 'text-destructive text-sm mt-1',
  }
}
