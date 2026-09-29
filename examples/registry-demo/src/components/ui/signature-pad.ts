import { button, div, input } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { buttonVariants } from './button'

/**
 * Signature pad — skin for `@llui/components/signature-pad`. No shadcn
 * counterpart.
 *
 * `data-drawing` and `data-readonly` are published on the ROOT, not on the
 * control, so the control reads them through the named `group/signature-pad`.
 * Its recipe used to spell them as bare `data-drawing:` / `data-readonly:` on
 * the control itself, where they never matched: the border did not respond to
 * drawing and a read-only pad still took strokes' pointer events (#266).
 *
 * `guide` is the baseline the user signs on. It is `pointer-events-none`
 * because it sits OVER the drawing surface: without that it swallows the
 * pointer and the middle of the pad stops accepting strokes.
 *
 * `hiddenInput` carries the serialized signature for a native form submit and
 * must stay in the DOM — `sr-only`, never `hidden`.
 *
 * PARTIAL by classification (#266): this skin owns the frame, the guide, the
 * drawing/disabled/read-only states and the triggers; the CONSUMER draws the
 * ink from the stroke points the machine records (an SVG path per stroke with
 * `stroke="currentColor"`, or a canvas), because the surface technology is
 * theirs to choose. The control sets `text-foreground`, so currentColor ink
 * follows the theme. Undo also restores a destructive clear until the next
 * stroke, and `data-empty` on the root marks an unsigned pad.
 */
export const SignaturePad = classPart(
  div,
  'group/signature-pad flex w-full max-w-sm flex-col gap-2 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const SignaturePadControl = classPart(
  div,
  'relative h-32 w-full touch-none rounded-md border border-input bg-background text-foreground shadow-xs transition-[color,box-shadow] group-data-drawing/signature-pad:border-ring group-data-readonly/signature-pad:pointer-events-none group-data-readonly/signature-pad:bg-muted forced-colors:border-[ButtonText]',
)
export const SignaturePadGuide = classPart(
  div,
  'pointer-events-none absolute inset-x-4 bottom-6 border-b border-dashed border-muted-foreground/40',
)
export const SignaturePadClearTrigger = classPart(
  button,
  buttonVariants({ variant: 'outline', size: 'sm' }),
)
export const SignaturePadUndoTrigger = classPart(
  button,
  buttonVariants({ variant: 'ghost', size: 'sm' }),
)
export const SignaturePadHiddenInput = classPart(input, 'sr-only')
