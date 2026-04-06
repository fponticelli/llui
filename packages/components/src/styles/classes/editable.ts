import { createVariants, type VariantProps } from '../utils/variants'

const inputVariants = createVariants({
  base: 'w-full bg-surface border border-border outline-none transition-all duration-fast focus:border-border-focus',
  variants: {
    size: {
      sm: 'px-2 py-1 text-sm rounded-md',
      md: 'px-3 py-1.5 rounded-md',
      lg: 'px-4 py-2 text-lg rounded-lg',
    },
  },
  defaultVariants: { size: 'md' },
})

type Variants = {
  size: { sm: string; md: string; lg: string }
}

export type EditableStyleVariants = VariantProps<Variants>

export interface EditableClasses {
  root: string
  preview: string
  input: string
  submitTrigger: string
  cancelTrigger: string
  editTrigger: string
}

export function editableClasses(props?: EditableStyleVariants): EditableClasses {
  return {
    root: 'inline-flex items-center gap-2',
    preview:
      'cursor-pointer hover:bg-surface-hover rounded-md px-1 transition-colors duration-fast',
    input: inputVariants(props),
    submitTrigger:
      'inline-flex items-center justify-center cursor-pointer text-primary hover:text-primary-hover transition-colors duration-fast',
    cancelTrigger:
      'inline-flex items-center justify-center cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
    editTrigger:
      'inline-flex items-center justify-center cursor-pointer text-text-muted hover:text-text transition-colors duration-fast',
  }
}
