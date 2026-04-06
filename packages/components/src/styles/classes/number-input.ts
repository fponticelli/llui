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
  base: 'flex-1 bg-transparent border-none outline-none text-center min-w-0',
  variants: {
    size: {
      sm: 'px-2 text-sm',
      md: 'px-3',
      lg: 'px-4 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const buttonVariants = createVariants({
  base: 'flex items-center justify-center bg-transparent border-none cursor-pointer text-text-muted hover:bg-surface-hover hover:text-text transition-colors duration-fast data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-8 text-sm',
      md: 'w-10',
      lg: 'w-12 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type NumberInputStyleVariants = VariantProps<Variants>

export interface NumberInputClasses {
  root: string
  input: string
  increment: string
  decrement: string
}

export function numberInputClasses(props?: NumberInputStyleVariants): NumberInputClasses {
  return {
    root: rootVariants(props),
    input: inputVariants(props),
    increment: buttonVariants(props),
    decrement: buttonVariants(props),
  }
}
