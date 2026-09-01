import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn). Note the track is
 * `bg-primary/20` — a tint of the fill, not `bg-muted`.
 *
 * `@llui/components/progress` writes a determinate range's width or height as
 * an inline style. An indeterminate range has no numeric style, so this skin
 * owns its one-third visual and reduced-motion-safe pulse.
 */
export const ProgressTrack = classPart(
  div,
  'relative h-2 w-full overflow-hidden rounded-full bg-primary/20 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-32 data-[orientation=vertical]:w-2',
)
export const ProgressRange = classPart(
  div,
  'h-full flex-1 bg-primary transition-all data-[state=indeterminate]:w-1/3 data-[state=indeterminate]:animate-pulse data-[orientation=vertical]:w-full [&[data-orientation=vertical][data-state=indeterminate]]:h-1/3 [&[data-orientation=vertical][data-state=indeterminate]]:w-full motion-reduce:data-[state=indeterminate]:animate-none motion-reduce:transition-none',
)
export const Progress = classPart(
  div,
  'flex w-full flex-col gap-1.5 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-fit',
)
export const ProgressLabel = classPart(span, 'text-sm font-medium')
