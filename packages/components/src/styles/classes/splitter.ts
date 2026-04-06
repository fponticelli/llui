import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'flex w-full',
  variants: {
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

const resizeTriggerVariants = createVariants({
  base: 'flex items-center justify-center bg-border transition-colors duration-fast hover:bg-border-hover data-[disabled]:opacity-50',
  variants: {
    orientation: {
      horizontal: 'w-1 cursor-col-resize',
      vertical: 'h-1 cursor-row-resize',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
})

type Variants = {
  orientation: { horizontal: string; vertical: string }
}

export type SplitterStyleVariants = VariantProps<Variants>

export interface SplitterClasses {
  root: string
  primaryPanel: string
  secondaryPanel: string
  resizeTrigger: string
}

export function splitterClasses(props?: SplitterStyleVariants): SplitterClasses {
  return {
    root: rootVariants(props),
    primaryPanel: 'overflow-auto',
    secondaryPanel: 'overflow-auto',
    resizeTrigger: resizeTriggerVariants(props),
  }
}
