import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex items-center border border-border bg-surface overflow-hidden transition-all duration-fast focus-within:border-border-focus',
  variants: {
    size: {
      sm: 'rounded-md h-8 text-sm',
      md: 'rounded-md h-10',
      lg: 'rounded-lg h-12 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const inputVariants = createVariants({
  base: 'flex-1 bg-transparent border-none outline-none min-w-0',
  variants: {
    size: {
      sm: 'px-2.5 text-sm',
      md: 'px-3',
      lg: 'px-4 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type PasswordInputStyleVariants = VariantProps<Variants>

export interface PasswordInputClasses {
  root: string
  input: string
  visibilityTrigger: string
}

export function passwordInputClasses(props?: PasswordInputStyleVariants): PasswordInputClasses {
  return {
    root: rootVariants(props),
    input: inputVariants(props),
    visibilityTrigger:
      'flex items-center justify-center px-2 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
