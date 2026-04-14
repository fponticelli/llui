import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'flex flex-wrap items-center gap-1.5 border border-border bg-surface transition-all duration-fast focus-within:border-border-focus',
  variants: {
    size: {
      sm: 'px-2 py-1 rounded-md min-h-8 text-sm',
      md: 'px-3 py-1.5 rounded-md min-h-10',
      lg: 'px-4 py-2 rounded-lg min-h-12 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const tagVariants = createVariants({
  base: 'inline-flex items-center gap-1 bg-surface-active rounded-md font-medium',
  variants: {
    size: {
      sm: 'px-1.5 py-0.5 text-xs',
      md: 'px-2 py-0.5 text-sm',
      lg: 'px-2.5 py-1 text-base',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TagsInputStyleVariants = VariantProps<Variants>

export interface TagsInputClasses {
  root: string
  input: string
  tag: string
  tagRemove: string
  clearTrigger: string
}

export function tagsInputClasses(props?: TagsInputStyleVariants): TagsInputClasses {
  return {
    root: rootVariants(props),
    input: 'flex-1 bg-transparent border-none outline-none min-w-16',
    tag: tagVariants(props),
    tagRemove: 'cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    clearTrigger: 'cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
