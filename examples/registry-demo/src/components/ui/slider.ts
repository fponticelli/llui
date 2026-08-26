import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * The thumb's `hover:ring-4` / `focus-visible:ring-4` is the mouse state — a
 * widening halo rather than a colour change, which is why the thumb declares
 * `ring-ring/50` up front with a zero-width ring.
 *
 * `bg-white`, not `bg-background`, and that is upstream's choice rather than an
 * oversight: the thumb stays white in BOTH themes so it reads against the
 * primary-filled range either way. Swapping it for the theme token makes the
 * thumb vanish into a dark track.
 *
 * `@llui/components/slider` writes the thumb offset and range extent as inline
 * styles from the value, so no view here reads state.
 */
export const Slider = classPart(
  div,
  'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
)
export const SliderControl = classPart(div, 'relative flex w-full grow items-center')
export const SliderTrack = classPart(
  div,
  'relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
)
export const SliderRange = classPart(
  div,
  'absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
)
export const SliderThumb = classPart(
  span,
  'block size-4 shrink-0 rounded-full border border-primary bg-white shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
)
