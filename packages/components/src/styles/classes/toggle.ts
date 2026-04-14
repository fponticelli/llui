import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'inline-flex items-center justify-center border border-border rounded-md bg-surface cursor-pointer transition-all duration-fast hover:bg-surface-hover data-[state=on]:bg-surface-active data-[state=on]:border-border-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'p-1.5 text-sm',
      md: 'p-2',
      lg: 'p-3 text-lg',
    },
    variant: {
      outline: '',
      ghost: 'border-transparent',
    },
  },
  defaultVariants: { size: 'md', variant: 'outline' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  variant: { outline: string; ghost: string }
}

export type ToggleStyleVariants = VariantProps<Variants>

export interface ToggleClasses {
  root: string
}

export function toggleClasses(props?: ToggleStyleVariants): ToggleClasses {
  return {
    root: rootVariants(props),
  }
}
