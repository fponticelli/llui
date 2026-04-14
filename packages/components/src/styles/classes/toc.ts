import { createVariants, type VariantProps } from '../utils/variants.js'

const linkVariants = createVariants({
  base: 'block text-text-muted transition-colors duration-fast hover:text-text data-[state=active]:text-primary data-[state=active]:font-medium',
  variants: {
    size: {
      sm: 'py-0.5 text-xs',
      md: 'py-1 text-sm',
      lg: 'py-1.5',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TocStyleVariants = VariantProps<Variants>

export interface TocClasses {
  root: string
  list: string
  item: string
  link: string
  expandTrigger: string
}

export function tocClasses(props?: TocStyleVariants): TocClasses {
  return {
    root: '',
    list: 'flex flex-col border-l border-border pl-3',
    item: '',
    link: linkVariants(props),
    expandTrigger:
      'inline-flex items-center justify-center cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
