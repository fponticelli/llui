import { a, button, div, li, ul } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Table of contents — skin for `@llui/components/toc`. No shadcn counterpart,
 * though the indent-by-depth idiom is the Sidebar's.
 *
 * Indent comes from `data-level`, which the machine publishes as a number, so
 * it is the CONSUMER's to turn into padding — the same arrangement as the tree
 * view, and for the same reason: the step is a styling decision.
 *
 * The current entry is marked TWICE and both are needed: `aria-current` is what
 * assistive tech reads, `data-active` is the styling hook. `data-state` on the
 * expand trigger is open/closed, not active.
 */
export const Toc = classPart(div, 'flex flex-col gap-1 text-sm')
export const TocList = classPart(ul, 'flex flex-col gap-0.5 border-l')
export const TocItem = classPart(li, 'flex items-center gap-1')
export const TocLink = classPart(
  a,
  '-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:border-primary data-active:font-medium data-active:text-foreground',
)
export const TocExpandTrigger = classPart(
  button,
  'inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:rotate-90',
)
