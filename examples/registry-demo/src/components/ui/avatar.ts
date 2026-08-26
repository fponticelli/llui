import { div, img, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * `data-size` drives the dimensions and the fallback's text size through the
 * `group/avatar` name. `@llui/components/avatar` does not emit it, so pass
 * `'data-size': 'default'` (or `'sm'` / `'lg'`) on the root.
 */
export const Avatar = classPart(
  div,
  'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6',
)
export const AvatarImage = classPart(img, 'aspect-square size-full')
export const AvatarFallback = classPart(
  span,
  'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs',
)
export const AvatarBadge = classPart(
  span,
  'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2 group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
)
