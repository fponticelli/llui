import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'flex',
  variants: {
    orientation: {
      horizontal: 'flex-row items-center',
      vertical: 'flex-col',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

const triggerVariants = createVariants({
  base: 'inline-flex items-center justify-center rounded-full font-medium border-2 border-border bg-surface transition-all duration-fast data-[state=complete]:bg-primary data-[state=complete]:border-primary data-[state=complete]:text-text-inverted data-[state=current]:border-primary data-[state=current]:text-primary',
  variants: {
    size: {
      sm: 'w-7 h-7 text-xs',
      md: 'w-9 h-9 text-sm',
      lg: 'w-11 h-11',
    },
  },
  defaultVariants: { size: 'md' },
})

const separatorVariants = createVariants({
  base: 'bg-border data-[state=complete]:bg-primary transition-colors duration-fast',
  variants: {
    orientation: {
      horizontal: 'h-0.5 flex-1 mx-2',
      vertical: 'w-0.5 flex-none ml-4 my-1 min-h-6',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  orientation: { horizontal: string; vertical: string }
}

export type StepsStyleVariants = VariantProps<Variants>

export interface StepsClasses {
  root: string
  item: string
  trigger: string
  separator: string
  nextTrigger: string
  prevTrigger: string
}

export function stepsClasses(props?: StepsStyleVariants): StepsClasses {
  return {
    root: rootVariants(props),
    item: 'flex items-center',
    trigger: triggerVariants(props),
    separator: separatorVariants(props),
    nextTrigger: '',
    prevTrigger: '',
  }
}
