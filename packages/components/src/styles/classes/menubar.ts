import { createVariants, type VariantProps } from '../utils/variants.js'

const triggerVariants = createVariants({
  base: 'inline-flex items-center rounded-md font-medium cursor-pointer transition-colors duration-fast text-text outline-none hover:bg-surface-hover focus-visible:bg-surface-hover data-[state=open]:bg-surface-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2 py-1 text-sm gap-1',
      md: 'px-3 py-1.5 gap-2',
      lg: 'px-4 py-2 text-lg gap-2',
    },
  },
  defaultVariants: { size: 'md' },
})

const contentVariants = createVariants({
  base: 'bg-surface border border-border shadow-md overflow-hidden',
  variants: {
    size: {
      sm: 'rounded-md py-1 min-w-32 text-sm',
      md: 'rounded-md py-1 min-w-40',
      lg: 'rounded-lg py-1.5 min-w-48 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const itemVariants = createVariants({
  base: 'flex items-center cursor-pointer transition-colors duration-fast data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'px-2 py-1 text-sm gap-2',
      md: 'px-3 py-1.5 gap-2',
      lg: 'px-4 py-2 text-lg gap-3',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type MenubarStyleVariants = VariantProps<Variants>

export interface MenubarClasses {
  root: string
  trigger: string
  positioner: string
  content: string
  item: string
}

export function menubarClasses(props?: MenubarStyleVariants): MenubarClasses {
  return {
    root: 'flex items-center gap-1',
    trigger: triggerVariants(props),
    positioner: 'absolute z-popover',
    content: contentVariants(props),
    item: itemVariants(props),
  }
}
