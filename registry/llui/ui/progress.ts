import { div, span } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Progress — skin for `@llui/components/progress`. The `range` part's width is
 * written by the package as an inline style from the value, so the recipe never
 * computes it; that is what keeps this a pure skin.
 */
export const Progress = classPart(div, 'flex w-full flex-col gap-1.5')
export const ProgressLabel = classPart(span, 'text-sm font-medium')
export const ProgressTrack = classPart(
  div,
  'relative h-2 w-full overflow-hidden rounded-full bg-muted',
)
export const ProgressRange = classPart(
  div,
  'h-full rounded-full bg-primary transition-[width] duration-normal data-[state=indeterminate]:animate-pulse',
)
