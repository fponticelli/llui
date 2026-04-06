import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex items-center justify-center border-2 border-border rounded-sm cursor-pointer transition-all duration-fast data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:border-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
      lg: 'w-6 h-6',
    },
    colorScheme: {
      primary: 'data-[state=checked]:bg-primary data-[state=checked]:border-primary',
      destructive: 'data-[state=checked]:bg-destructive data-[state=checked]:border-destructive',
    },
  },
  defaultVariants: { size: 'md', colorScheme: 'primary' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  colorScheme: { primary: string; destructive: string }
}

export type CheckboxStyleVariants = VariantProps<Variants>

export interface CheckboxClasses {
  root: string
  indicator: string
  label: string
}

export function checkboxClasses(props?: CheckboxStyleVariants): CheckboxClasses {
  return {
    root: rootVariants(props),
    indicator: 'text-text-inverted flex items-center justify-center data-[state=unchecked]:hidden',
    label: 'text-text select-none',
  }
}
