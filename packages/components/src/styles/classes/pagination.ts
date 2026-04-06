import { createVariants, type VariantProps } from '../utils/variants'

const itemVariants = createVariants({
  base: 'inline-flex items-center justify-center border border-border rounded-md cursor-pointer transition-all duration-fast hover:bg-surface-hover data-[state=active]:bg-primary data-[state=active]:border-primary data-[state=active]:text-text-inverted data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-7 h-7 text-sm',
      md: 'w-9 h-9',
      lg: 'w-11 h-11 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const navTriggerVariants = createVariants({
  base: 'inline-flex items-center justify-center border border-border rounded-md cursor-pointer transition-all duration-fast hover:bg-surface-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'w-7 h-7 text-sm',
      md: 'w-9 h-9',
      lg: 'w-11 h-11 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type PaginationStyleVariants = VariantProps<Variants>

export interface PaginationClasses {
  root: string
  prevTrigger: string
  nextTrigger: string
  item: string
  ellipsis: string
}

export function paginationClasses(props?: PaginationStyleVariants): PaginationClasses {
  return {
    root: 'inline-flex items-center gap-1',
    prevTrigger: navTriggerVariants(props),
    nextTrigger: navTriggerVariants(props),
    item: itemVariants(props),
    ellipsis: 'inline-flex items-center justify-center text-text-muted',
  }
}
