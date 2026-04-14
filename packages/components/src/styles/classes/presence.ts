import { type VariantProps } from '../utils/variants.js'

type Variants = Record<string, never>

export type PresenceStyleVariants = VariantProps<Variants>

export interface PresenceClasses {
  root: string
}

export function presenceClasses(): PresenceClasses {
  return {
    root: '',
  }
}
