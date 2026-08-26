import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn). Note the track is
 * `bg-primary/20` — a tint of the fill, not `bg-muted`.
 *
 * `@llui/components/progress` writes the range's width as an inline style from
 * the value, so the recipe never computes it.
 */
export const ProgressTrack = classPart(
  div,
  'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
)
export const ProgressRange = classPart(div, 'h-full flex-1 bg-primary transition-all')
export const Progress = classPart(div, 'flex w-full flex-col gap-1.5')
export const ProgressLabel = classPart(span, 'text-sm font-medium')
