import { type VariantProps } from '../utils/variants.js'

type Variants = Record<string, never>

export type ImageCropperStyleVariants = VariantProps<Variants>

export interface ImageCropperClasses {
  root: string
  image: string
  cropBox: string
  resizeHandle: string
  resetTrigger: string
}

export function imageCropperClasses(): ImageCropperClasses {
  return {
    root: 'relative overflow-hidden inline-block',
    image: 'block max-w-full',
    cropBox: 'absolute border-2 border-primary bg-primary/10 cursor-move',
    resizeHandle: 'absolute w-3 h-3 bg-surface border-2 border-primary rounded-sm',
    resetTrigger:
      'inline-flex items-center justify-center px-3 py-1.5 border border-border rounded-md cursor-pointer transition-colors duration-fast hover:bg-surface-hover',
  }
}
