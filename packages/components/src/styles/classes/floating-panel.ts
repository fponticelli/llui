import { createVariants, type VariantProps } from '../utils/variants'

const rootVariants = createVariants({
  base: 'fixed bg-surface border border-border shadow-lg rounded-xl flex flex-col overflow-hidden z-popover',
  variants: {
    size: {
      sm: 'min-w-64 min-h-48',
      md: 'min-w-80 min-h-60',
      lg: 'min-w-96 min-h-72',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type FloatingPanelStyleVariants = VariantProps<Variants>

export interface FloatingPanelClasses {
  root: string
  dragHandle: string
  content: string
  minimizeTrigger: string
  maximizeTrigger: string
  closeTrigger: string
  resizeHandle: string
}

export function floatingPanelClasses(props?: FloatingPanelStyleVariants): FloatingPanelClasses {
  return {
    root: rootVariants(props),
    dragHandle:
      'flex items-center justify-between px-3 py-2 bg-surface-muted cursor-grab active:cursor-grabbing border-b border-border',
    content: 'flex-1 overflow-auto p-4',
    minimizeTrigger:
      'inline-flex items-center justify-center w-6 h-6 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    maximizeTrigger:
      'inline-flex items-center justify-center w-6 h-6 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    closeTrigger:
      'inline-flex items-center justify-center w-6 h-6 bg-transparent border-none cursor-pointer text-text-muted hover:text-destructive transition-colors duration-fast',
    resizeHandle: 'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize',
  }
}
