import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Slider — skin for `@llui/components/slider`. The package writes the thumb's
 * offset and the range's extent as inline styles from the value; the recipe only
 * describes appearance, which is why dragging works without a view reading state.
 */
export const Slider = classPart(
  div,
  'relative flex w-full touch-none items-center select-none data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50',
)
export const SliderControl = classPart(div, 'relative flex w-full grow items-center')
export const SliderTrack = classPart(
  div,
  'relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
)
export const SliderRange = classPart(div, 'absolute h-full rounded-full bg-primary')
export const SliderThumb = classPart(
  span,
  'block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring',
)
