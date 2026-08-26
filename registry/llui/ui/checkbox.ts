import { button, input, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * Three parts: the visible `root` button, an `indicator` span, and a
 * `hiddenInput` carrying the value into a native form submit. Render the hidden
 * input — without it the control is invisible to `FormData`.
 */
export const Checkbox = classPart(
  button,
  'peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
)
export const CheckboxIndicator = classPart(
  span,
  'grid place-content-center text-current transition-none',
)
export const CheckboxHiddenInput = classPart(input, 'sr-only')
