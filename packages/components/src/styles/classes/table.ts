import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'w-full border-collapse text-sm text-text',
  variants: {
    size: {
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-base',
    },
  },
  defaultVariants: { size: 'md' },
})

const headerCellVariants = createVariants({
  base: 'text-left font-medium text-text-muted border-b border-border select-none',
  variants: {
    size: {
      sm: 'px-2 py-1',
      md: 'px-3 py-2',
      lg: 'px-4 py-3',
    },
  },
  defaultVariants: { size: 'md' },
})

const cellVariants = createVariants({
  base: 'border-b border-border align-middle',
  variants: {
    size: {
      sm: 'px-2 py-1',
      md: 'px-3 py-2',
      lg: 'px-4 py-3',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TableStyleVariants = VariantProps<Variants>

export interface TableClasses {
  root: string
  header: string
  headerRow: string
  headerCell: string
  sortIndicator: string
  body: string
  row: string
  cell: string
  checkbox: string
}

export function tableClasses(props?: TableStyleVariants): TableClasses {
  return {
    root: rootVariants(props),
    header: '',
    headerRow: '',
    headerCell: `${headerCellVariants(props)} data-[sortable]:cursor-pointer data-[sortable]:hover:text-text`,
    sortIndicator: 'inline-block ml-1 text-text-subtle',
    body: '',
    row: 'transition-colors hover:bg-surface-hover data-[selected]:bg-primary-subtle',
    cell: `${cellVariants(props)} data-[focused]:outline data-[focused]:outline-2 data-[focused]:outline-primary -outline-offset-2`,
    checkbox: 'cursor-pointer accent-primary',
  }
}
