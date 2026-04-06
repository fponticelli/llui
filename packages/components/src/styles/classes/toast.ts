import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'bg-surface border border-border shadow-lg p-4 relative flex items-start gap-3',
  variants: {
    size: {
      sm: 'rounded-md min-w-64 text-sm',
      md: 'rounded-lg min-w-80',
      lg: 'rounded-lg min-w-96 text-lg',
    },
    variant: {
      default: '',
      success: 'border-l-4 border-l-primary',
      error: 'border-l-4 border-l-destructive',
    },
  },
  defaultVariants: { size: 'md', variant: 'default' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  variant: { default: string; success: string; error: string }
}

export type ToastStyleVariants = VariantProps<Variants>

export interface ToastClasses {
  region: string
  root: string
  title: string
  description: string
  closeTrigger: string
}

export function toastClasses(props?: ToastStyleVariants): ToastClasses {
  return {
    region: 'fixed z-tooltip flex flex-col gap-2 p-4',
    root: rootVariants(props),
    title: 'font-semibold',
    description: 'text-text-muted',
    closeTrigger:
      'absolute top-2 right-2 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
