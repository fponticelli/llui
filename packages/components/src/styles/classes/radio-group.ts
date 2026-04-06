import { createVariants, type VariantProps } from '../utils/variants'

const controlVariants = createVariants({
  base: 'border-2 border-border rounded-full flex items-center justify-center transition-all duration-fast data-[state=checked]:border-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
      lg: 'w-6 h-6',
    },
    colorScheme: {
      primary: 'data-[state=checked]:border-primary',
      destructive: 'data-[state=checked]:border-destructive',
    },
  },
  defaultVariants: { size: 'md', colorScheme: 'primary' },
})

const indicatorVariants = createVariants({
  base: 'rounded-full data-[state=unchecked]:hidden',
  variants: {
    size: {
      sm: 'w-2 h-2',
      md: 'w-2.5 h-2.5',
      lg: 'w-3 h-3',
    },
    colorScheme: {
      primary: 'bg-primary',
      destructive: 'bg-destructive',
    },
  },
  defaultVariants: { size: 'md', colorScheme: 'primary' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  colorScheme: { primary: string; destructive: string }
}

export type RadioGroupStyleVariants = VariantProps<Variants>

export interface RadioGroupClasses {
  root: string
  item: string
  control: string
  indicator: string
  label: string
}

export function radioGroupClasses(
  props?: RadioGroupStyleVariants,
): RadioGroupClasses {
  return {
    root: 'flex flex-col gap-2',
    item: 'flex items-center gap-2 cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
    control: controlVariants(props),
    indicator: indicatorVariants(props),
    label: 'text-text select-none',
  }
}
