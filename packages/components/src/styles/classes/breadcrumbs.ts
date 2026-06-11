import { createVariants, type VariantProps } from '../utils/variants.js'

const linkVariants = createVariants({
  base: 'inline-flex items-center text-text-muted no-underline cursor-pointer transition-colors duration-fast hover:text-text hover:underline data-[current]:text-text data-[current]:font-medium data-[current]:cursor-default data-[current]:no-underline',
  variants: {
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type BreadcrumbsStyleVariants = VariantProps<Variants>

export interface BreadcrumbsClasses {
  root: string
  list: string
  item: string
  link: string
  separator: string
  ellipsisTrigger: string
}

export function breadcrumbsClasses(props?: BreadcrumbsStyleVariants): BreadcrumbsClasses {
  return {
    root: 'inline-flex',
    list: 'inline-flex items-center gap-2 list-none m-0 p-0',
    item: 'inline-flex items-center gap-2',
    link: linkVariants(props),
    separator: 'inline-flex items-center text-text-muted select-none',
    ellipsisTrigger:
      'inline-flex items-center justify-center text-text-muted cursor-pointer bg-transparent border-0 p-0 transition-colors duration-fast hover:text-text',
  }
}
