import { createVariants, type VariantProps } from '../utils/variants.js'

const listVariants = createVariants({
  base: 'flex relative',
  variants: {
    variant: {
      underline: 'border-b border-border gap-1',
      outline: 'gap-1',
      pill: 'gap-1 bg-surface-muted rounded-lg p-1',
    },
  },
  defaultVariants: { variant: 'underline' },
})

const triggerVariants = createVariants({
  base: 'font-medium cursor-pointer transition-all duration-fast',
  variants: {
    size: {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg',
    },
    variant: {
      underline:
        'bg-transparent border-none border-b-2 border-transparent text-text-muted hover:text-text data-[state=active]:text-primary data-[state=active]:border-b-primary',
      outline:
        'bg-transparent border border-transparent rounded-md text-text-muted hover:text-text data-[state=active]:border-border data-[state=active]:text-text',
      pill: 'bg-transparent border-none rounded-md text-text-muted hover:text-text data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm',
    },
  },
  defaultVariants: { size: 'md', variant: 'underline' },
})

const panelVariants = createVariants({
  base: '',
  variants: {
    size: {
      sm: 'p-3 text-sm',
      md: 'p-4',
      lg: 'p-6 text-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  variant: { underline: string; outline: string; pill: string }
}

export type TabsStyleVariants = VariantProps<Variants>

export interface TabsClasses {
  root: string
  list: string
  trigger: string
  panel: string
  indicator: string
}

export function tabsClasses(props?: TabsStyleVariants): TabsClasses {
  return {
    root: 'flex flex-col data-[orientation=vertical]:flex-row',
    list: listVariants(props),
    trigger: triggerVariants(props),
    panel: panelVariants(props),
    indicator: 'absolute bottom-0 h-0.5 bg-primary transition-all duration-normal',
  }
}
