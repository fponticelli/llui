import { type VariantProps } from '../utils/variants'

type Variants = Record<string, never>

export type FileUploadStyleVariants = VariantProps<Variants>

export interface FileUploadClasses {
  root: string
  dropzone: string
  trigger: string
  hiddenInput: string
  label: string
  clearTrigger: string
  itemGroup: string
  item: string
  itemName: string
  itemSizeText: string
  itemPreview: string
  itemRemove: string
  itemDeleteTrigger: string
}

export function fileUploadClasses(): FileUploadClasses {
  return {
    root: 'flex flex-col gap-3',
    dropzone:
      'flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 transition-colors duration-fast hover:border-border-hover data-[dragging]:border-primary data-[dragging]:bg-primary/5',
    trigger:
      'inline-flex items-center justify-center px-4 py-2 bg-primary text-text-inverted rounded-md cursor-pointer font-medium transition-colors duration-fast hover:bg-primary-hover',
    hiddenInput: 'sr-only',
    label: 'font-medium text-text',
    clearTrigger: 'cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    itemGroup: 'flex flex-col gap-2',
    item: 'flex items-center gap-3 p-2 border border-border rounded-md',
    itemName: 'font-medium text-sm truncate',
    itemSizeText: 'text-xs text-text-muted',
    itemPreview: 'w-10 h-10 rounded-md object-cover',
    itemRemove:
      'cursor-pointer text-text-muted hover:text-destructive transition-colors duration-fast',
    itemDeleteTrigger:
      'cursor-pointer text-text-muted hover:text-destructive transition-colors duration-fast',
  }
}
