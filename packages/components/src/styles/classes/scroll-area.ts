import { type VariantProps } from '../utils/variants.js'

type Variants = Record<string, never>

export type ScrollAreaStyleVariants = VariantProps<Variants>

export interface ScrollAreaClasses {
  root: string
  viewport: string
  content: string
  scrollbar: string
  thumb: string
  corner: string
}

export function scrollAreaClasses(): ScrollAreaClasses {
  return {
    root: 'relative overflow-hidden',
    viewport: 'w-full h-full overflow-auto',
    content: '',
    scrollbar:
      'flex touch-none select-none transition-colors duration-fast data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col',
    thumb:
      'relative flex-1 rounded-full bg-border hover:bg-border-hover transition-colors duration-fast',
    corner: 'bg-surface-muted',
  }
}
