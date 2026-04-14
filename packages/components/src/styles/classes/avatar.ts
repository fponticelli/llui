import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'inline-flex items-center justify-center rounded-full bg-surface-active overflow-hidden',
  variants: {
    size: {
      sm: 'w-8 h-8 text-sm',
      md: 'w-10 h-10',
      lg: 'w-14 h-14 text-lg',
      xl: 'w-20 h-20 text-xl',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string; xl: string }
}

export type AvatarStyleVariants = VariantProps<Variants>

export interface AvatarClasses {
  root: string
  image: string
  fallback: string
}

export function avatarClasses(props?: AvatarStyleVariants): AvatarClasses {
  return {
    root: rootVariants(props),
    image: 'w-full h-full object-cover',
    fallback: 'font-medium text-text-muted',
  }
}
