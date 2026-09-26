import { button, div, input, select } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { inputRecipe } from './input'

/**
 * Gradient picker — skin for `@llui/components/gradient-picker`. No shadcn
 * counterpart (shadcn has no gradient authoring UI), so this recipe matches
 * `color-picker.ts`'s language and tokens instead of porting anything: same
 * `rangeRecipe` shape for the angle `<input type="range">`, the same
 * checkerboard trick for alpha visibility, the same icon-button shape for
 * add/remove/reverse/distribute, and the same toggle-button shape
 * (`data-[state=on]:bg-accent`) `toggle-group.ts` uses for `kindToggle`/
 * `shapeOption`/`sizeOption`.
 *
 * The machine's `data-kind` (`linear | radial | conic`) decides which cluster
 * of parts a consuming view PLACES (the center area/thumb only make sense for
 * radial/conic, the shape/size toggles only for radial) — that is a
 * `branch()`/`show()` decision in the view, so every part below is styled
 * unconditionally, same discipline `color-picker.ts` documents for its own
 * `data-model` split.
 */
const rangeRecipe =
  'h-3 w-full cursor-pointer appearance-none rounded-full bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-foreground'

const toggleButtonRecipe =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium outline-none transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground'

const iconButtonRecipe =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4'

/** Auto-width, text-labeled ("Reverse" / "Distribute") — never squeezed
 * into the fixed icon-button square above. */
const textButtonRecipe =
  'inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent px-3 text-xs font-medium outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50'

const selectRecipe =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50'

/** The checkerboard alpha backdrop `color-picker.ts` uses under its alpha
 * slider/preview — repeated here so a gradient with translucent stops reads
 * as transparent rather than as a lighter opaque color. */
const checkerboard =
  'bg-[repeating-conic-gradient(#e5e5e5_0_25%,transparent_0_50%)] bg-[length:12px_12px]'

export const GradientPicker = classPart(
  div,
  'group/gradient-picker flex w-full max-w-md flex-col gap-3 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const GradientPickerPreview = classPart(
  div,
  `h-24 w-full rounded-md border bg-clip-padding ${checkerboard}`,
)
export const GradientPickerTrack = classPart(
  // `touch-none` — the machine owns pointer drag (pointerdown adds+drags a
  // stop), and without it a touch drag also scrolls the page.
  div,
  `relative h-8 w-full touch-none cursor-copy rounded-md border bg-clip-padding ${checkerboard}`,
)
export const GradientPickerStop = classPart(
  // A `<div role="slider">`, not a `<button>` — like `color-picker.ts`'s
  // `ColorPickerAreaThumb`, this overrides its role and owns its own
  // keyboard handling (arrow nudge, Home/End, Delete), so it should not also
  // carry a button's native Enter/Space activation semantics.
  div,
  'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-background shadow-sm outline-none active:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring/50 data-selected:ring-2 data-selected:ring-ring data-selected:ring-offset-2 data-selected:ring-offset-background',
)
export const GradientPickerAddStopButton = classPart(button, iconButtonRecipe)
export const GradientPickerRemoveStopButton = classPart(button, iconButtonRecipe)
export const GradientPickerKindToggle = classPart(button, toggleButtonRecipe)
export const GradientPickerRepeatingToggle = classPart(button, toggleButtonRecipe)
export const GradientPickerReverseButton = classPart(button, textButtonRecipe)
export const GradientPickerDistributeButton = classPart(button, textButtonRecipe)
export const GradientPickerAngleInput = classPart(input, rangeRecipe)
export const GradientPickerCenterArea = classPart(
  div,
  'relative size-28 shrink-0 touch-none rounded-md border bg-muted',
)
export const GradientPickerCenterThumb = classPart(
  div,
  'absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
)
export const GradientPickerShapeOption = classPart(button, toggleButtonRecipe)
export const GradientPickerSizeOption = classPart(button, toggleButtonRecipe)
export const GradientPickerInterpolationSpaceSelect = classPart(select, selectRecipe)
export const GradientPickerInterpolationHueSelect = classPart(select, selectRecipe)
export const GradientPickerCssInput = classPart(
  input,
  `${inputRecipe} font-mono text-xs aria-invalid:border-destructive aria-invalid:ring-destructive/20`,
)
/** The describable error region `cssInput`'s `aria-describedby` points at.
 * `visible`/`message` are plain (non-attribute) signals on the part bag —
 * like `form-field`'s `errorText.message` — so the CONSUMER decides how to
 * show/hide it (typically `show(parts.cssError.visible, () => …)`); this
 * recipe only styles the mounted-and-visible case. */
export const GradientPickerCssError = classPart(div, 'text-xs text-destructive')
