import { div, p } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Data table — skin for `@llui/components/patterns/data-table`.
 *
 * shadcn ships no `data-table.tsx`: its docs are a GUIDE to composing `table`
 * with TanStack Table, so there is no upstream recipe to port. The table itself
 * therefore stays `@/ui/table`, verbatim — this module adds only the three
 * status surfaces the pattern owns and `table` has no notion of.
 *
 * Each of the three carries its own reactive `hidden`, so the machine decides
 * which is showing and none of them needs a rule here. Do NOT toggle them with
 * `show` instead: `emptyState` and `errorState` are `aria-live` regions
 * (`role="status"` / `role="alert"`), and unmounting a live region announces
 * nothing — the whole point of having them.
 *
 * `loadingOverlay` is `absolute inset-0` over the table rather than replacing
 * it, so a page-to-page load keeps the previous rows visible underneath instead
 * of collapsing the layout to a spinner and back. Its container needs
 * `relative`; that is the consumer's, since only they know how much of the
 * surface the overlay should cover.
 */
export const DataTableLoadingOverlay = classPart(
  div,
  'absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/60 backdrop-blur-[1px]',
)
export const DataTableEmptyState = classPart(
  div,
  'flex flex-col items-center justify-center gap-1 px-6 py-12 text-center',
)
export const DataTableEmptyTitle = classPart(p, 'text-sm font-medium')
export const DataTableEmptyDescription = classPart(p, 'text-sm text-muted-foreground')
export const DataTableErrorState = classPart(
  div,
  'flex flex-col items-center justify-center gap-2 rounded-md border border-destructive/50 px-6 py-12 text-center text-sm text-destructive',
)
