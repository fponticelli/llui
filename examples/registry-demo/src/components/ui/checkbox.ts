import { button, input, span, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass } from '../../lib/utils'
import { CheckIcon, MinusIcon } from './icons'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * Three parts: the visible `root` button, an `indicator` span, and a
 * `hiddenInput` carrying the value into a native form submit. Render the hidden
 * input — without it the control is invisible to `FormData`.
 *
 * `group/checkbox` on the root is what lets the indicator pick its glyph from
 * the root's `data-state`; it is not decoration.
 */
export const Checkbox = classPart(
  button,
  'peer group/checkbox size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
)

/**
 * The indicator renders BOTH glyphs and lets the root's `data-state` choose
 * between them in CSS, rather than a view reading state to decide. A tri-state
 * checkbox has three looks and only two of them draw anything, so branching in
 * CSS is what keeps this a pure skin — and it is why the root carries
 * `group/checkbox`.
 */
export function CheckboxIndicator(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return span(
    {
      ...rest,
      class: mergeClass(
        'grid place-content-center text-current transition-none group-data-[state=unchecked]/checkbox:invisible',
        className,
      ),
    },
    [
      CheckIcon({ class: 'size-3.5 group-data-[state=indeterminate]/checkbox:hidden' }),
      MinusIcon({ class: 'size-3.5 group-data-[state=checked]/checkbox:hidden' }),
    ],
  )
}

export const CheckboxHiddenInput = classPart(input, 'sr-only')
