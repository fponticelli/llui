import { type VariantProps } from '../utils/variants.js'

type Variants = Record<string, never>

export type QrCodeStyleVariants = VariantProps<Variants>

export interface QrCodeClasses {
  root: string
  svg: string
  downloadTrigger: string
}

export function qrCodeClasses(): QrCodeClasses {
  return {
    root: 'inline-flex flex-col items-center gap-2',
    svg: 'rounded-md',
    downloadTrigger:
      'inline-flex items-center justify-center px-3 py-1.5 text-sm border border-border rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover',
  }
}
