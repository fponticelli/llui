import { type VariantProps } from '../utils/variants'

type Variants = Record<string, never>

export type NavigationMenuStyleVariants = VariantProps<Variants>

export interface NavigationMenuClasses {
  root: string
  trigger: string
  content: string
}

export function navigationMenuClasses(): NavigationMenuClasses {
  return {
    root: 'flex items-center gap-1',
    trigger:
      'inline-flex items-center px-3 py-2 rounded-md font-medium cursor-pointer transition-colors duration-fast text-text-muted hover:text-text hover:bg-surface-hover data-[state=open]:text-text data-[state=open]:bg-surface-hover',
    content: 'absolute z-popover bg-surface border border-border shadow-lg rounded-lg p-4',
  }
}
