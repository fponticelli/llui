import { createVariants, type VariantProps } from '../utils/variants.js'

const controlVariants = createVariants({
  base: 'relative flex items-center cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'h-4',
      md: 'h-5',
      lg: 'h-6',
    },
  },
  defaultVariants: { size: 'md' },
})

const trackVariants = createVariants({
  base: 'w-full bg-surface-active relative overflow-hidden',
  variants: {
    size: {
      sm: 'h-1 rounded-full',
      md: 'h-1.5 rounded-full',
      lg: 'h-2 rounded-full',
    },
  },
  defaultVariants: { size: 'md' },
})

const thumbVariants = createVariants({
  base: 'absolute bg-surface border-2 border-primary rounded-full shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary',
  variants: {
    size: {
      sm: 'w-3.5 h-3.5 -translate-x-1/2',
      md: 'w-4.5 h-4.5 -translate-x-1/2',
      lg: 'w-5.5 h-5.5 -translate-x-1/2',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type SliderStyleVariants = VariantProps<Variants>

export interface SliderClasses {
  root: string
  control: string
  track: string
  range: string
  thumb: string
}

export function sliderClasses(props?: SliderStyleVariants): SliderClasses {
  return {
    root: 'w-full',
    control: controlVariants(props),
    track: trackVariants(props),
    range: 'absolute h-full bg-primary rounded-full',
    thumb: thumbVariants(props),
  }
}
