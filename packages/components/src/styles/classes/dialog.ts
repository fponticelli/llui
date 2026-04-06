import { createVariants, type VariantProps } from '../utils/variants'

const contentVariants = createVariants({
  base: 'bg-surface rounded-xl shadow-lg p-6 relative w-full',
  variants: {
    size: {
      sm: 'max-w-sm',
      md: 'max-w-lg',
      lg: 'max-w-2xl',
      full: 'max-w-[calc(100vw-2rem)]',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string; full: string }
}

export type DialogStyleVariants = VariantProps<Variants>

export interface DialogClasses {
  trigger: string
  backdrop: string
  positioner: string
  content: string
  title: string
  description: string
  closeTrigger: string
}

export function dialogClasses(props?: DialogStyleVariants): DialogClasses {
  return {
    trigger: '',
    backdrop:
      'fixed inset-0 bg-black/50 z-dialog data-[state=open]:animate-in data-[state=open]:fade-in',
    positioner: 'fixed inset-0 flex items-center justify-center z-dialog',
    content: contentVariants(props),
    title: 'text-lg font-semibold mb-2',
    description: 'text-text-muted mb-4',
    closeTrigger:
      'absolute top-3 right-3 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
