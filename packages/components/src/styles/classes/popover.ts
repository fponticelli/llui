import { createVariants, type VariantProps } from '../utils/variants.js'

const contentVariants = createVariants({
  base: 'bg-surface border border-border shadow-lg rounded-xl p-4 relative',
  variants: {
    size: {
      sm: 'max-w-xs text-sm',
      md: 'max-w-sm',
      lg: 'max-w-md text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type PopoverStyleVariants = VariantProps<Variants>

export interface PopoverClasses {
  trigger: string
  positioner: string
  content: string
  title: string
  description: string
  arrow: string
  closeTrigger: string
}

export function popoverClasses(props?: PopoverStyleVariants): PopoverClasses {
  return {
    trigger: '',
    positioner: 'absolute z-popover',
    content: contentVariants(props),
    title: 'font-semibold mb-1',
    description: 'text-text-muted',
    arrow: 'fill-surface stroke-border',
    closeTrigger:
      'absolute top-2 right-2 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
