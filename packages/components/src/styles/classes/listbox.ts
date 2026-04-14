import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'flex flex-col border border-border overflow-auto bg-surface',
  variants: {
    size: {
      sm: 'rounded-md text-sm',
      md: 'rounded-md',
      lg: 'rounded-lg text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const itemVariants = createVariants({
  base: 'flex items-center cursor-pointer transition-colors duration-fast data-[highlighted]:bg-surface-hover data-[state=selected]:bg-surface-active data-[state=selected]:text-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2 py-1 text-sm',
      md: 'px-3 py-1.5',
      lg: 'px-4 py-2 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type ListboxStyleVariants = VariantProps<Variants>

export interface ListboxClasses {
  root: string
  item: string
}

export function listboxClasses(props?: ListboxStyleVariants): ListboxClasses {
  return {
    root: rootVariants(props),
    item: itemVariants(props),
  }
}
