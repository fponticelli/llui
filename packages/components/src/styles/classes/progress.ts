import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'w-full',
  variants: {
    size: {
      sm: '',
      md: '',
      lg: '',
    },
  },
  defaultVariants: { size: 'md' },
})

const trackVariants = createVariants({
  base: 'w-full bg-surface-active overflow-hidden',
  variants: {
    size: {
      sm: 'h-1.5 rounded-full',
      md: 'h-2.5 rounded-full',
      lg: 'h-4 rounded-full',
    },
  },
  defaultVariants: { size: 'md' },
})

const rangeVariants = createVariants({
  base: 'h-full transition-all duration-normal',
  variants: {
    size: {
      sm: 'rounded-full',
      md: 'rounded-full',
      lg: 'rounded-full',
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

export type ProgressStyleVariants = VariantProps<Variants>

export interface ProgressClasses {
  root: string
  track: string
  range: string
  label: string
}

export function progressClasses(props?: ProgressStyleVariants): ProgressClasses {
  return {
    root: rootVariants(props),
    track: trackVariants(props),
    range: rangeVariants(props),
    label: 'text-sm text-text-muted',
  }
}
