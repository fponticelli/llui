import { type VariantProps } from '../utils/variants'

type Variants = Record<string, never>

export type SignaturePadStyleVariants = VariantProps<Variants>

export interface SignaturePadClasses {
  root: string
  control: string
  clearTrigger: string
  undoTrigger: string
  guide: string
  hiddenInput: string
}

export function signaturePadClasses(): SignaturePadClasses {
  return {
    root: 'flex flex-col gap-2',
    control: 'border-2 border-dashed border-border rounded-lg bg-surface cursor-crosshair min-h-32',
    clearTrigger:
      'inline-flex items-center justify-center px-3 py-1.5 border border-border rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover',
    undoTrigger:
      'inline-flex items-center justify-center px-3 py-1.5 border border-border rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover',
    guide: 'absolute bottom-4 left-4 right-4 border-b border-border',
    hiddenInput: 'sr-only',
  }
}
