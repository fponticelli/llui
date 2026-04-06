import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'flex flex-col overflow-hidden',
  variants: {
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
    variant: {
      outline: 'border border-border rounded-lg',
      filled: 'bg-surface-muted rounded-lg',
      ghost: '',
    },
  },
  defaultVariants: { size: 'md', variant: 'outline' },
})

const triggerVariants = createVariants({
  base: 'flex items-center justify-between w-full px-4 font-medium bg-surface border-none border-b border-border cursor-pointer transition-colors duration-fast hover:bg-surface-hover data-[state=open]:bg-surface-muted',
  variants: {
    size: {
      sm: 'py-2 text-sm',
      md: 'py-3',
      lg: 'py-4 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const contentVariants = createVariants({
  base: '',
  variants: {
    size: {
      sm: 'p-3 text-sm',
      md: 'p-4',
      lg: 'p-6 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  variant: { outline: string; filled: string; ghost: string }
}

export type AccordionStyleVariants = VariantProps<Variants>

export interface AccordionClasses {
  root: string
  item: string
  trigger: string
  content: string
}

export function accordionClasses(
  props?: AccordionStyleVariants,
): AccordionClasses {
  return {
    root: rootVariants(props),
    item: 'border-b border-border last:border-b-0',
    trigger: triggerVariants(props),
    content: contentVariants(props),
  }
}
