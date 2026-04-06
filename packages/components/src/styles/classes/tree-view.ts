import { createVariants, type VariantProps } from '../utils/variants'

const itemVariants = createVariants({
  base: 'flex items-center cursor-pointer transition-colors duration-fast hover:bg-surface-hover data-[state=selected]:bg-surface-active rounded-md',
  variants: {
    size: {
      sm: 'px-2 py-0.5 text-sm gap-1.5',
      md: 'px-2 py-1 gap-2',
      lg: 'px-3 py-1.5 text-lg gap-2.5',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TreeViewStyleVariants = VariantProps<Variants>

export interface TreeViewClasses {
  root: string
  item: string
  branchTrigger: string
  checkbox: string
}

export function treeViewClasses(props?: TreeViewStyleVariants): TreeViewClasses {
  return {
    root: 'flex flex-col',
    item: itemVariants(props),
    branchTrigger:
      'inline-flex items-center justify-center text-text-muted transition-transform duration-fast data-[state=open]:rotate-90',
    checkbox:
      'inline-flex items-center justify-center border-2 border-border rounded-sm w-4 h-4 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:border-primary',
  }
}
