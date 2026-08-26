import { button, div, input } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { buttonVariants } from './button'

/**
 * Signature pad — skin for `@llui/components/signature-pad`. No shadcn
 * counterpart.
 *
 * `data-drawing` is on the ROOT, not the canvas, so the border can respond
 * while the pointer is down without a rule reaching into the control.
 *
 * `guide` is the baseline the user signs on. It is `pointer-events-none`
 * because it sits OVER the drawing surface: without that it swallows the
 * pointer and the middle of the pad stops accepting strokes.
 *
 * `hiddenInput` carries the serialized signature for a native form submit and
 * must stay in the DOM — `sr-only`, never `hidden`.
 */
export const SignaturePad = classPart(
  div,
  'flex w-full max-w-sm flex-col gap-2 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const SignaturePadControl = classPart(
  div,
  'relative h-32 w-full touch-none rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] data-drawing:border-ring data-readonly:pointer-events-none',
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
