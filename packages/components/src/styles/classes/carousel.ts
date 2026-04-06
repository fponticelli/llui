import { createVariants, type VariantProps } from '../utils/variants'

const navTriggerVariants = createVariants({
  base: 'inline-flex items-center justify-center rounded-full bg-surface border border-border shadow-sm cursor-pointer transition-all duration-fast hover:bg-surface-hover data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
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

export type CarouselStyleVariants = VariantProps<Variants>

export interface CarouselClasses {
  root: string
  viewport: string
  slide: string
  indicatorGroup: string
  indicator: string
  nextTrigger: string
  prevTrigger: string
}

export function carouselClasses(props?: CarouselStyleVariants): CarouselClasses {
  return {
    root: 'relative overflow-hidden',
    viewport: 'overflow-hidden',
    slide: 'min-w-0 flex-shrink-0 flex-grow-0',
    indicatorGroup: 'flex items-center justify-center gap-1.5 mt-3',
    indicator:
      'w-2 h-2 rounded-full bg-surface-active cursor-pointer transition-colors duration-fast data-[state=active]:bg-primary',
    nextTrigger: navTriggerVariants(props),
    prevTrigger: navTriggerVariants(props),
  }
}
