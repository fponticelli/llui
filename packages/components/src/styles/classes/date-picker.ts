import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'inline-flex flex-col bg-surface border border-border shadow-md',
  variants: {
    size: {
      sm: 'rounded-md p-2 text-sm',
      md: 'rounded-lg p-3',
      lg: 'rounded-lg p-4 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

const dayCellVariants = createVariants({
  base: 'inline-flex items-center justify-center rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover data-[state=selected]:bg-primary data-[state=selected]:text-text-inverted data-[today]:font-bold data-[outside-range]:opacity-30 data-[outside-range]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
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

export type DatePickerStyleVariants = VariantProps<Variants>

export interface DatePickerClasses {
  root: string
  grid: string
  dayCell: string
  prevMonthTrigger: string
  nextMonthTrigger: string
}

export function datePickerClasses(props?: DatePickerStyleVariants): DatePickerClasses {
  return {
    root: rootVariants(props),
    grid: 'grid grid-cols-7 gap-0.5',
    dayCell: dayCellVariants(props),
    prevMonthTrigger:
      'inline-flex items-center justify-center cursor-pointer bg-transparent border-none text-text-muted hover:text-text transition-colors duration-fast',
    nextMonthTrigger:
      'inline-flex items-center justify-center cursor-pointer bg-transparent border-none text-text-muted hover:text-text transition-colors duration-fast',
  }
}
