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

/**
 * A stack of overlapping avatars. `data-size` on the GROUP resizes every member
 * through `group-has-data-[size=…]/avatar-group:`, which is why the members read
 * the group rather than each carrying their own size.
 */
export const AvatarGroup = classPart(
  div,
  'group/avatar-group flex -space-x-2 *:ring-2 *:ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
)
