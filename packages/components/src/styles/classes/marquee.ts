import { type VariantProps } from '../utils/variants'

type Variants = Record<string, never>

export type MarqueeStyleVariants = VariantProps<Variants>

export interface MarqueeClasses {
  root: string
  content: string
}

export function marqueeClasses(): MarqueeClasses {
  return {
    root: 'overflow-hidden',
    content: 'inline-flex whitespace-nowrap',
  }
}
