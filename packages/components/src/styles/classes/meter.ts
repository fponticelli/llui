import { createVariants, type VariantProps } from '../utils/variants.js'

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
  base: 'h-full transition-all duration-normal rounded-full data-[state=optimal]:bg-success data-[state=high]:bg-warning data-[state=low]:bg-destructive',
  variants: {
    size: {
      sm: '',
      md: '',
      lg: '',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type MeterStyleVariants = VariantProps<Variants>

export interface MeterClasses {
  root: string
  track: string
  range: string
  label: string
}

export function meterClasses(props?: MeterStyleVariants): MeterClasses {
  return {
    root: rootVariants(props),
    track: trackVariants(props),
    range: rangeVariants(props),
    label: 'text-sm text-text-muted',
  }
}
