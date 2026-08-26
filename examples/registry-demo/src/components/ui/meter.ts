import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Meter — skin for `@llui/components/meter`. Unlike Progress, a meter shows a
 * measurement within a known range, so the range part is tinted by
 * `data-state` (`optimal` / `suboptimal` / `critical`) rather than always
 * primary.
 */
export const Meter = classPart(div, 'flex w-full flex-col gap-1.5')
export const MeterLabel = classPart(span, 'text-sm font-medium')
export const MeterTrack = classPart(div, 'h-2 w-full overflow-hidden rounded-full bg-muted')
export const MeterRange = classPart(
  div,
  'h-full rounded-full bg-primary transition-[width] duration-normal data-[state=critical]:bg-destructive data-[state=suboptimal]:bg-accent-strong',
)
