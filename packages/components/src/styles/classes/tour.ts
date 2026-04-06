import { type VariantProps } from '../utils/variants'

type Variants = Record<string, never>

export type TourStyleVariants = VariantProps<Variants>

export interface TourClasses {
  root: string
  backdrop: string
  spotlight: string
  title: string
  description: string
  progressText: string
  prevTrigger: string
  nextTrigger: string
  closeTrigger: string
}

export function tourClasses(): TourClasses {
  return {
    root: 'fixed z-tooltip bg-surface border border-border shadow-lg rounded-xl p-4 max-w-sm',
    backdrop: 'fixed inset-0 bg-black/50 z-dialog',
    spotlight: 'absolute rounded-md shadow-lg ring-4 ring-primary/30 z-dialog',
    title: 'font-semibold mb-1',
    description: 'text-text-muted mb-3',
    progressText: 'text-xs text-text-muted',
    prevTrigger:
      'inline-flex items-center justify-center px-3 py-1.5 border border-border rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover',
    nextTrigger:
      'inline-flex items-center justify-center px-3 py-1.5 bg-primary text-text-inverted rounded-md cursor-pointer font-medium transition-colors duration-fast hover:bg-primary-hover',
    closeTrigger:
      'absolute top-2 right-2 bg-transparent border-none cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
