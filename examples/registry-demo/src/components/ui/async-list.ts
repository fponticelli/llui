import { button, div, p } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { buttonVariants } from './button'

/**
 * Async list — skin for `@llui/components/async-list`. No shadcn counterpart.
 *
 * `sentinel` is the IntersectionObserver target that triggers the next page. It
 * must have real HEIGHT — a zero-height element never intersects, and the list
 * silently stops loading. `h-px` is enough and is why it is here rather than
 * left to the consumer.
 *
 * `data-status` on the root is the full lifecycle (`idle` / `loading` /
 * `loaded` / `error`), which is what lets the trigger and the error text style
 * themselves from the container instead of each tracking state. The root also
 * publishes `aria-busy` while a page loads, `data-empty` once a load settles
 * with nothing, and `data-exhausted` when no pages remain — the load-more
 * trigger steps back (`invisible`, keeping its space) rather than sitting there
 * disabled forever (#266).
 */
export const AsyncList = classPart(
  div,
  'group/async-list flex flex-col gap-2 aria-busy:cursor-progress',
)
export const AsyncListSentinel = classPart(div, 'h-px w-full')
export const AsyncListLoadMoreTrigger = classPart(
  button,
  `${buttonVariants({ variant: 'outline', size: 'sm' })} self-center group-data-exhausted/async-list:invisible`,
)
export const AsyncListRetryTrigger = classPart(
  button,
  `${buttonVariants({ variant: 'outline', size: 'sm' })} self-center`,
)
export const AsyncListErrorText = classPart(p, 'text-center text-sm text-destructive')
