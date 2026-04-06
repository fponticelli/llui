import { type VariantProps } from '../utils/variants'

type Variants = Record<string, never>

export type ColorPickerStyleVariants = VariantProps<Variants>

export interface ColorPickerClasses {
  root: string
  hueSlider: string
  saturationSlider: string
  lightnessSlider: string
  hexInput: string
  swatch: string
}

export function colorPickerClasses(): ColorPickerClasses {
  return {
    root: 'flex flex-col gap-3 p-3 bg-surface border border-border rounded-lg shadow-md',
    hueSlider: 'w-full h-3 rounded-full cursor-pointer',
    saturationSlider: 'w-full h-3 rounded-full cursor-pointer',
    lightnessSlider: 'w-full h-3 rounded-full cursor-pointer',
    hexInput:
      'w-full px-2 py-1 text-sm border border-border rounded-md bg-surface outline-none focus:border-border-focus transition-colors duration-fast',
    swatch: 'w-8 h-8 rounded-md border border-border',
  }
}
