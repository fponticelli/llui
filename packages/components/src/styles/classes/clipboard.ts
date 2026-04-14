import { type VariantProps } from '../utils/variants.js'

type Variants = Record<string, never>

export type ClipboardStyleVariants = VariantProps<Variants>

export interface ClipboardClasses {
  root: string
  trigger: string
  input: string
  indicator: string
}

export function clipboardClasses(): ClipboardClasses {
  return {
    root: 'inline-flex items-center gap-2',
    trigger:
      'inline-flex items-center justify-center px-3 py-1.5 border border-border rounded-md bg-surface cursor-pointer transition-colors duration-fast hover:bg-surface-hover',
    input:
      'px-3 py-1.5 border border-border rounded-md bg-surface-muted text-text-muted select-all outline-none',
    indicator: 'text-primary transition-opacity duration-fast',
  }
}
