import { button, div, img } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * Image cropper — skin for `@llui/components/image-cropper`. No shadcn
 * counterpart.
 *
 * The crop box is positioned by the machine through an inline `style`, so this
 * recipe sets no geometry — same rule as `floating-panel`.
 *
 * The dimming outside the box is an enormous `box-shadow` on the box itself,
 * not four overlay divs. Overlays have to be positioned in step with the box
 * and get it wrong during a drag; a spread shadow is always exactly the
 * complement of wherever the box is.
 *
 * `pointer-events-none` on the image matters: without it the browser's native
 * image drag starts on every pointerdown and the crop gesture never begins.
 *
 * `data-handle` names WHICH corner a grip is (`nw`/`ne`/`sw`/`se`), so the
 * cursor and the placement are one rule per corner rather than four components.
 * The grips stay PHYSICAL under `dir="rtl"`: the image is not mirrored, so a
 * north-west grip is still top-left.
 *
 * `data-dragging` is published on the ROOT, not the box, so the grabbing cursor
 * reaches the box through `group/image-cropper` — a bare `data-dragging:` on the
 * box never matched (#266). The box is also a keyboard stop (arrows move it,
 * `+`/`-` zoom), so its focus ring is live; under forced colors, where the dim
 * shadow is dropped, a `Highlight` outline keeps the crop edge visible.
 */
export const ImageCropper = classPart(
  div,
  'group/image-cropper relative w-full max-w-sm touch-none overflow-hidden rounded-md border bg-muted select-none data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const ImageCropperImage = classPart(img, 'pointer-events-none block w-full select-none')
export const ImageCropperCropBox = classPart(
  div,
  'absolute cursor-move border-2 border-background shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] outline-none group-data-dragging/image-cropper:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring/50 forced-colors:outline-2 forced-colors:outline-[Highlight]',
)
export const ImageCropperResizeHandle = classPart(
  div,
  'absolute size-3 rounded-full border-2 border-background bg-primary data-[handle=ne]:-top-1.5 data-[handle=ne]:-right-1.5 data-[handle=ne]:cursor-nesw-resize data-[handle=nw]:-top-1.5 data-[handle=nw]:-left-1.5 data-[handle=nw]:cursor-nwse-resize data-[handle=se]:-right-1.5 data-[handle=se]:-bottom-1.5 data-[handle=se]:cursor-nwse-resize data-[handle=sw]:-bottom-1.5 data-[handle=sw]:-left-1.5 data-[handle=sw]:cursor-nesw-resize',
)
export const ImageCropperResetTrigger = classPart(
  button,
  buttonVariants({ variant: 'outline', size: 'sm' }),
)
