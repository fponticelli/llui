import { createVariants, type VariantProps } from '../utils/variants.js'

const inputVariants = createVariants({
  base: 'w-full bg-surface border border-border outline-none transition-all duration-fast placeholder:text-text-muted focus:border-border-focus data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2.5 py-1.5 text-sm rounded-md',
      md: 'px-3 py-2 rounded-md',
      lg: 'px-4 py-2.5 text-lg rounded-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const contentVariants = createVariants({
  base: 'bg-surface border border-border shadow-md overflow-auto',
  variants: {
    size: {
      sm: 'rounded-md py-1 text-sm',
      md: 'rounded-md py-1',
      lg: 'rounded-lg py-1.5 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const itemVariants = createVariants({
  base: 'flex items-center cursor-pointer transition-colors duration-fast data-[highlighted]:bg-surface-hover data-[state=checked]:text-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
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

export type ComboboxStyleVariants = VariantProps<Variants>

export interface ComboboxClasses {
  root: string
  input: string
  trigger: string
  positioner: string
  content: string
  item: string
  empty: string
}

export function comboboxClasses(props?: ComboboxStyleVariants): ComboboxClasses {
  return {
    root: 'relative',
    input: inputVariants(props),
    trigger:
      'absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    positioner: 'absolute z-popover',
    content: contentVariants(props),
    item: itemVariants(props),
    empty: 'px-3 py-2 text-text-muted',
  }
}
