import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: '',
  variants: {
    variant: {
      default: 'border border-border rounded-lg',
      ghost: '',
    },
  },
  defaultVariants: { variant: 'default' },
})

const triggerVariants = createVariants({
  base: 'flex items-center justify-between w-full bg-transparent border-none cursor-pointer font-medium transition-colors duration-fast hover:bg-surface-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-3 py-2 text-sm',
      md: 'px-4 py-3',
      lg: 'px-5 py-4 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const contentVariants = createVariants({
  base: 'overflow-hidden data-[state=closed]:hidden',
  variants: {
    size: {
      sm: 'px-3 pb-3 text-sm',
      md: 'px-4 pb-4',
      lg: 'px-5 pb-5 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  variant: { default: string; ghost: string }
}

export type CollapsibleStyleVariants = VariantProps<Variants>

export interface CollapsibleClasses {
  root: string
  trigger: string
  content: string
}

export function collapsibleClasses(props?: CollapsibleStyleVariants): CollapsibleClasses {
  return {
    root: rootVariants(props),
    trigger: triggerVariants(props),
    content: contentVariants(props),
  }
}
