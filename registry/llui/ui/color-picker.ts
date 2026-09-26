import { button, canvas, div, input } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { inputRecipe } from '@/ui/input'

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
 * Only the HUE slider carries a background here. The saturation, lightness,
 * chroma, OKLCH-lightness and alpha tracks get a live gradient from the
 * machine as an inline `style`, and inline style beats these classes — but
 * declaring a background anyway would paint the wrong colour for the frame
 * before the first commit.
 *
 * The alpha track sits over a checkerboard so partial opacity is visible as
 * opacity rather than as a lighter colour.
 *
 * The machine's `data-model` (`'hsv' | 'oklch'`) decides WHICH cluster of
 * parts (hue/saturation/lightness sliders vs. chroma/OKLCH-lightness
 * sliders, hue backdrop vs. area canvas) a consuming view places — that is a
 * `branch()`/`show()` decision in the view, not something this stylesheet
 * hides with CSS, so every part below is styled unconditionally.
 */
const rangeRecipe =
  'h-3 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground'

export const ColorPicker = classPart(
  div,
  'group/color-picker flex w-full max-w-xs flex-col gap-3 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const ColorPickerArea = classPart(
  // `touch-none` (`touch-action: none`) — the machine owns pointer drag
  // (`onPointerDown` etc., pointer-captured), and without this a touch drag
  // also pans/scrolls the page instead of only moving the thumb.
  div,
  'relative h-32 w-full touch-none cursor-crosshair rounded-md border',
)
/** OKLCH-mode plane; absolutely positioned to fill `ColorPickerArea` and
 * `pointer-events-none` so pointer/drag handling stays on the area div
 * underneath it — the machine's `areaCanvas` part is decorative only. */
export const ColorPickerAreaCanvas = classPart(
  canvas,
  'pointer-events-none absolute inset-0 size-full rounded-md',
)
export const ColorPickerAreaThumb = classPart(
  div,
  'absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-transparent shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
)
export const ColorPickerHueSlider = classPart(
  input,
  // `data-model` is published on the ROOT (and `area`), not on this input
  // itself, so the OKLCH-mode background is a `group-data-*` variant keyed
  // off `ColorPicker`'s `group/color-picker` rather than a plain `data-*`
  // variant, which would check this element's own (nonexistent) attribute.
  `${rangeRecipe} bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] group-data-[model=oklch]/color-picker:bg-[linear-gradient(in_oklch_longer_hue,oklch(0.75_0.15_0),oklch(0.75_0.15_360))]`,
)
export const ColorPickerSaturationSlider = classPart(input, rangeRecipe)
export const ColorPickerLightnessSlider = classPart(input, rangeRecipe)
export const ColorPickerChromaSlider = classPart(input, rangeRecipe)
export const ColorPickerOklchLightnessSlider = classPart(input, rangeRecipe)
export const ColorPickerAlphaSlider = classPart(
  input,
  `${rangeRecipe} bg-[repeating-conic-gradient(#e5e5e5_0_25%,transparent_0_50%)] bg-[length:12px_12px]`,
)
export const ColorPickerHexInput = classPart(input, `${inputRecipe} font-mono uppercase`)
/** Sits over a checkerboard (like the alpha track) so a translucent color
 * reads as transparent rather than as a lighter opaque one; ringed with the
 * shared `--warning` token (never a raw Tailwind color like `amber-500` —
 * a hardcoded accent can't follow a theme's own warning color, and this one
 * already exists precisely for this kind of "notice, not an error" cue)
 * when the machine reports `data-out-of-gamut` (an OKLCH color outside
 * sRGB — the swatch itself is always gamut-mapped/clipped for display).
 * `data-out-of-gamut` is published on the ROOT, not on this element, hence
 * `group-data-out-of-gamut` rather than a plain `data-out-of-gamut` variant. */
export const ColorPickerPreview = classPart(
  div,
  'size-9 shrink-0 rounded-md border bg-[repeating-conic-gradient(#e5e5e5_0_25%,transparent_0_50%)] bg-[length:8px_8px] bg-clip-padding group-data-out-of-gamut/color-picker:ring-2 group-data-out-of-gamut/color-picker:ring-warning group-data-out-of-gamut/color-picker:ring-offset-2 group-data-out-of-gamut/color-picker:ring-offset-background',
)
export const ColorPickerSwatchGroup = classPart(div, 'flex flex-wrap gap-1.5')
export const ColorPickerSwatch = classPart(
  button,
  'size-6 rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=selected]:ring-2 data-[state=selected]:ring-ring data-[state=selected]:ring-offset-2 data-[state=selected]:ring-offset-background',
)
/** Small icon-only affordance beside the hex input. */
export const ColorPickerEyeDropperTrigger = classPart(
  button,
  'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
)
/** Cycles `data-model`; the consuming view supplies the label/icon children. */
export const ColorPickerModelToggle = classPart(
  button,
  'inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-input bg-transparent px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
)
