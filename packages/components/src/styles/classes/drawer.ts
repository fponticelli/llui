import { createVariants, type VariantProps } from '../utils/variants.js'

const positionerVariants = createVariants({
  base: 'fixed inset-0 z-dialog',
  variants: {
    placement: {
      left: 'flex justify-start',
      right: 'flex justify-end',
      top: 'flex flex-col items-stretch',
      bottom: 'flex flex-col items-stretch justify-end',
    },
  },
  defaultVariants: { placement: 'right' },
})

const contentVariants = createVariants({
  base: 'bg-surface shadow-lg relative flex flex-col overflow-auto',
  variants: {
    size: {
      sm: '',
      md: '',
      lg: '',
    },
    placement: {
      left: 'h-full',
      right: 'h-full',
      top: 'w-full',
      bottom: 'w-full',
    },
  },
  defaultVariants: { size: 'md', placement: 'right' },
  compoundVariants: [
    { size: 'sm', placement: 'left', class: 'w-64' },
    { size: 'sm', placement: 'right', class: 'w-64' },
    { size: 'sm', placement: 'top', class: 'h-48' },
    { size: 'sm', placement: 'bottom', class: 'h-48' },
    { size: 'md', placement: 'left', class: 'w-80' },
    { size: 'md', placement: 'right', class: 'w-80' },
    { size: 'md', placement: 'top', class: 'h-64' },
    { size: 'md', placement: 'bottom', class: 'h-64' },
    { size: 'lg', placement: 'left', class: 'w-96' },
    { size: 'lg', placement: 'right', class: 'w-96' },
    { size: 'lg', placement: 'top', class: 'h-80' },
    { size: 'lg', placement: 'bottom', class: 'h-80' },
  ],
})

type Variants = {
  size: { sm: string; md: string; lg: string }
  placement: { left: string; right: string; top: string; bottom: string }
}

export type DrawerStyleVariants = VariantProps<Variants>

export interface DrawerClasses {
  trigger: string
  backdrop: string
  positioner: string
  content: string
  title: string
  description: string
  closeTrigger: string
}

export function drawerClasses(props?: DrawerStyleVariants): DrawerClasses {
  return {
    trigger: '',
    backdrop: 'fixed inset-0 bg-black/50 z-dialog',
    positioner: positionerVariants(props),
    content: contentVariants(props),
    title: 'text-lg font-semibold mb-2 px-6 pt-6',
    description: 'text-text-muted mb-4 px-6',
    closeTrigger:
      'absolute top-3 right-3 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
