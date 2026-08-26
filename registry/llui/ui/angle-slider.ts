import { div, input, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Angle slider — skin for `@llui/components/angle-slider`. No shadcn
 * counterpart; the tokens and focus idiom are the registry's.
 *
 * The control is a DIAL, so the thumb is positioned by the consumer from
 * `data-value` (degrees) — the machine publishes the number and takes no view
 * on how it becomes a transform, because the radius is a styling decision. The
 * usual shape is a `rotate` on a wrapper with the thumb pushed out along one
 * axis; `origin-bottom` on that wrapper is what makes the rotation orbit the
 * centre rather than spin in place.
 *
 * `hiddenInput` is a real form control and must stay in the DOM for a native
 * submit — style it `sr-only`, never `hidden`, which removes it from the form.
 */
export const AngleSlider = classPart(div, 'flex flex-col items-center gap-2')
export const AngleSliderControl = classPart(
  div,
  'relative size-24 rounded-full border border-input bg-muted/40 shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const AngleSliderThumb = classPart(
  div,
  'absolute size-3 rounded-full border border-primary bg-background shadow-sm',
)
export const AngleSliderValueText = classPart(
  span,
  'text-sm text-muted-foreground tabular-nums select-none',
)
export const AngleSliderHiddenInput = classPart(input, 'sr-only')
