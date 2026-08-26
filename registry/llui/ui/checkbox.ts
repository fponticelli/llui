import { button, input, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Checkbox — skin for `@llui/components/checkbox`. Three parts: the visible
 * `root` button, an `indicator` span, and a `hiddenInput` that carries the value
 * into a native form submit. Render the hidden input — without it the control is
 * invisible to `FormData`.
 */
export const Checkbox = classPart(
  button,
  'peer inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border shadow-sm transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
)
export const CheckboxIndicator = classPart(
  span,
  'flex items-center justify-center text-current [&_svg]:size-3.5',
)
export const CheckboxHiddenInput = classPart(input, 'sr-only')
