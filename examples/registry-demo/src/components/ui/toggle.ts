import { button } from '@llui/dom'
import { createVariantsPart } from '../../lib/utils'

/** Toggle — skin for `@llui/components/toggle`. A single pressed/unpressed
 * button; `data-state=on` is what the recipe keys off. */
export const Toggle = createVariantsPart(button, {
  base: 'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-fast outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {
    variant: {
      default: 'bg-transparent',
      outline: 'border border-border bg-transparent shadow-sm',
    },
    size: { default: 'h-9 min-w-9 px-2', sm: 'h-8 min-w-8 px-1.5', lg: 'h-10 min-w-10 px-2.5' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})
