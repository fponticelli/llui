import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'relative inline-flex items-center justify-center rounded-full border-2 border-border bg-surface',
  variants: {
    size: {
      sm: 'w-16 h-16',
      md: 'w-24 h-24',
      lg: 'w-32 h-32',
    },
  },
  defaultVariants: { size: 'md' },
})

const thumbVariants = createVariants({
  base: 'absolute rounded-full bg-primary shadow-sm cursor-pointer',
  variants: {
    size: {
      sm: 'w-3 h-3',
      md: 'w-4 h-4',
      lg: 'w-5 h-5',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type AngleSliderStyleVariants = VariantProps<Variants>

export interface AngleSliderClasses {
  root: string
  control: string
  thumb: string
  valueText: string
  hiddenInput: string
}

export function angleSliderClasses(props?: AngleSliderStyleVariants): AngleSliderClasses {
  return {
    root: rootVariants(props),
    control: 'absolute inset-0',
    thumb: thumbVariants(props),
    valueText: 'text-sm font-medium text-text',
    hiddenInput: 'sr-only',
  }
}
