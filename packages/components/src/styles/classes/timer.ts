import { createVariants, type VariantProps } from '../utils/variants.js'

const displayVariants = createVariants({
  base: 'font-mono tabular-nums',
  variants: {
    size: {
      sm: 'text-xl',
      md: 'text-3xl',
      lg: 'text-5xl',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TimerStyleVariants = VariantProps<Variants>

export interface TimerClasses {
  root: string
  display: string
  startTrigger: string
  pauseTrigger: string
  resetTrigger: string
}

export function timerClasses(props?: TimerStyleVariants): TimerClasses {
  return {
    root: 'inline-flex flex-col items-center gap-3',
    display: displayVariants(props),
    startTrigger:
      'inline-flex items-center justify-center px-4 py-2 bg-primary text-text-inverted rounded-md cursor-pointer font-medium transition-colors duration-fast hover:bg-primary-hover',
    pauseTrigger:
      'inline-flex items-center justify-center px-4 py-2 border border-border rounded-md cursor-pointer font-medium transition-colors duration-fast hover:bg-surface-hover',
    resetTrigger:
      'inline-flex items-center justify-center px-4 py-2 border border-border rounded-md cursor-pointer font-medium transition-colors duration-fast hover:bg-surface-hover',
  }
}
