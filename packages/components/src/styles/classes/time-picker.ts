import { createVariants, type VariantProps } from '../utils/variants.js'

const rootVariants = createVariants({
  base: 'inline-flex items-center gap-1 border border-border bg-surface transition-all duration-fast focus-within:border-border-focus',
  variants: {
    size: {
      sm: 'rounded-md px-2 h-8 text-sm',
      md: 'rounded-md px-3 h-10',
      lg: 'rounded-lg px-4 h-12 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type TimePickerStyleVariants = VariantProps<Variants>

export interface TimePickerClasses {
  root: string
  hoursInput: string
  minutesInput: string
  periodTrigger: string
}

export function timePickerClasses(props?: TimePickerStyleVariants): TimePickerClasses {
  return {
    root: rootVariants(props),
    hoursInput: 'w-6 bg-transparent border-none outline-none text-center',
    minutesInput: 'w-6 bg-transparent border-none outline-none text-center',
    periodTrigger:
      'cursor-pointer bg-transparent border-none font-medium text-text-muted hover:text-text transition-colors duration-fast',
  }
}
