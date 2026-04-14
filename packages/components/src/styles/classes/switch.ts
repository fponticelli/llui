import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'inline-flex items-center cursor-pointer',
  variants: {
    size: {
      sm: 'gap-2',
      md: 'gap-3',
      lg: 'gap-4',
    },
  },
  defaultVariants: { size: 'md' },
})

const trackVariants = createVariants({
  base: 'relative rounded-full bg-surface-active transition-colors duration-fast data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-8 h-4',
      md: 'w-11 h-6',
      lg: 'w-14 h-7',
    },
    colorScheme: {
      primary: 'data-[state=checked]:bg-primary',
      destructive: 'data-[state=checked]:bg-destructive',
    },
  },
  defaultVariants: { size: 'md', colorScheme: 'primary' },
})

const thumbVariants = createVariants({
  base: 'absolute top-0.5 left-0.5 rounded-full bg-white shadow-sm transition-transform duration-fast',
  variants: {
    size: {
      sm: 'w-3 h-3 data-[state=checked]:translate-x-4',
      md: 'w-5 h-5 data-[state=checked]:translate-x-5',
      lg: 'w-6 h-6 data-[state=checked]:translate-x-7',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  colorScheme: { primary: string; destructive: string }
}

export type SwitchStyleVariants = VariantProps<Variants>

export interface SwitchClasses {
  root: string
  track: string
  thumb: string
  label: string
}

export function switchClasses(props?: SwitchStyleVariants): SwitchClasses {
  return {
    root: rootVariants(props),
    track: trackVariants(props),
    thumb: thumbVariants(props),
    label: 'text-text select-none',
  }
}
