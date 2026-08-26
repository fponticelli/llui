import { div, img, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** Avatar — skin for `@llui/components/avatar`. The package owns image
 * load/error state; `data-state` on the parts drives which of image/fallback is
 * visible, so nothing here reads state. */
export const Avatar = classPart(
  div,
  'relative flex size-8 shrink-0 overflow-hidden rounded-full bg-muted',
)
export const AvatarImage = classPart(img, 'aspect-square size-full object-cover')
export const AvatarFallback = classPart(
  span,
  'flex size-full items-center justify-center rounded-full text-xs font-medium text-muted-foreground',
)
