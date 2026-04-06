import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex items-center',
  variants: {
    size: {
      sm: 'gap-1 text-sm',
      md: 'gap-2',
      lg: 'gap-3 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type CascadeSelectStyleVariants = VariantProps<Variants>

export interface CascadeSelectClasses {
  root: string
  levelLabel: string
  levelSelect: string
  clearTrigger: string
}

export function cascadeSelectClasses(props?: CascadeSelectStyleVariants): CascadeSelectClasses {
  return {
    root: rootVariants(props),
    levelLabel: 'text-text-muted font-medium',
    levelSelect:
      'px-3 py-1.5 border border-border rounded-md bg-surface cursor-pointer transition-all duration-fast hover:border-border-hover focus:border-border-focus',
    clearTrigger: 'cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
