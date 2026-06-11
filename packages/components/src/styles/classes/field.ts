import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'flex flex-col gap-1.5 data-[disabled]:opacity-60',
  variants: {
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const labelVariants = createVariants({
  base: 'font-medium text-text select-none',
  variants: {
    size: {
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-base',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type FieldStyleVariants = VariantProps<Variants>

export interface FieldClasses {
  root: string
  label: string
  control: string
  description: string
  error: string
}

export function fieldClasses(props?: FieldStyleVariants): FieldClasses {
  return {
    root: rootVariants(props),
    label: labelVariants(props),
    control:
      'border border-border rounded-md bg-surface px-3 py-2 text-text transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:ring-destructive disabled:cursor-not-allowed disabled:opacity-50',
    description: 'text-xs text-text-muted',
    error: 'text-xs text-destructive',
  }
}
