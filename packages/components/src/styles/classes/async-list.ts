import { type VariantProps } from '../utils/variants.js'

type Variants = Record<string, never>

export type AsyncListStyleVariants = VariantProps<Variants>

export interface AsyncListClasses {
  root: string
  sentinel: string
  loadMoreTrigger: string
  retryTrigger: string
  errorText: string
}

export function asyncListClasses(): AsyncListClasses {
  return {
    root: 'flex flex-col',
    sentinel: '',
    loadMoreTrigger:
      'inline-flex items-center justify-center px-4 py-2 border border-border rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover mx-auto mt-4',
    retryTrigger:
      'inline-flex items-center justify-center px-4 py-2 border border-destructive text-destructive rounded-md cursor-pointer transition-colors duration-fast hover:bg-destructive/10 mx-auto mt-4',
    errorText: 'text-destructive text-sm text-center mt-2',
  }
}
