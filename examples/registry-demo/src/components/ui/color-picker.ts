import { button, div, input } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { inputRecipe } from './input'

/**
 * Color picker — skin for `@llui/components/color-picker`. No shadcn
 * counterpart.
 *
 * Its sliders are NATIVE `<input type="range">`, not the registry's `Slider`
 * (which skins a different machine), so the track and thumb are styled through
 * the vendor pseudo-elements. Both `::-webkit-slider-thumb` and
 * `::-moz-range-thumb` are written out: they cannot be combined into one
 * selector, because a selector list containing an unknown pseudo-element is
 * dropped WHOLE by every engine, so one shared rule would style neither.
 *
 * Only the HUE slider carries a background here. The saturation, lightness and
 * alpha tracks get a live gradient from the machine as an inline `style`, and
 * inline style beats these classes — but declaring a background anyway would
 * paint the wrong colour for the frame before the first commit.
 *
 * The alpha track sits over a checkerboard so partial opacity is visible as
 * opacity rather than as a lighter colour.
 */
const rangeRecipe =
  'h-3 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground'

export const ColorPicker = classPart(
  div,
  'flex w-full max-w-xs flex-col gap-3 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const ColorPickerArea = classPart(
  div,
  'relative h-32 w-full cursor-crosshair rounded-md border',
)
export const ColorPickerAreaThumb = classPart(
  div,
  'absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-transparent shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
)
export const ColorPickerHueSlider = classPart(
  input,
  `${rangeRecipe} bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]`,
)
export const ColorPickerSaturationSlider = classPart(input, rangeRecipe)
export const ColorPickerLightnessSlider = classPart(input, rangeRecipe)
export const ColorPickerAlphaSlider = classPart(
  input,
  `${rangeRecipe} bg-[repeating-conic-gradient(#e5e5e5_0_25%,transparent_0_50%)] bg-[length:12px_12px]`,
)
export const ColorPickerHexInput = classPart(input, `${inputRecipe} font-mono uppercase`)
export const ColorPickerPreview = classPart(div, 'size-9 shrink-0 rounded-md border')
export const ColorPickerSwatchGroup = classPart(div, 'flex flex-wrap gap-1.5')
export const ColorPickerSwatch = classPart(
  button,
  'size-6 rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=selected]:ring-2 data-[state=selected]:ring-ring data-[state=selected]:ring-offset-2 data-[state=selected]:ring-offset-background',
)
