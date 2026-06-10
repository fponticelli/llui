import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'flex flex-col gap-3 border border-border rounded-md p-4 data-[disabled]:opacity-60 data-[invalid]:border-destructive',
  variants: {
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const legendVariants = createVariants({
  base: 'font-semibold text-text px-1',
  variants: {
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type FieldsetStyleVariants = VariantProps<Variants>

export interface FieldsetClasses {
  root: string
  legend: string
  error: string
}

export function fieldsetClasses(props?: FieldsetStyleVariants): FieldsetClasses {
  return {
    root: rootVariants(props),
    legend: legendVariants(props),
    error: 'text-xs text-destructive',
  }
}
