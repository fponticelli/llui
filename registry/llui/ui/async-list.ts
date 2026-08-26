import { button, div, p } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

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
 * themselves from the container instead of each tracking state.
 */
export const AsyncList = classPart(div, 'flex flex-col gap-2')
export const AsyncListSentinel = classPart(div, 'h-px w-full')
export const AsyncListLoadMoreTrigger = classPart(
  button,
  `${buttonVariants({ variant: 'outline', size: 'sm' })} self-center`,
)
export const AsyncListRetryTrigger = classPart(
  button,
  `${buttonVariants({ variant: 'outline', size: 'sm' })} self-center`,
)
export const AsyncListErrorText = classPart(p, 'text-center text-sm text-destructive')
