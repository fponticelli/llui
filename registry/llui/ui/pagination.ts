import { a, button, li, nav, span, ul } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Pagination — skin for `@llui/components/pagination`. `data-selected` marks
 * the current page; the package also sets `aria-current`. */
export const Pagination = classPart(nav, 'mx-auto flex w-full justify-center')
export const PaginationContent = classPart(ul, 'flex flex-row items-center gap-1')
export const PaginationItem = classPart(li, '')
export const PaginationLink = classPart(
  a,
  'inline-flex size-9 items-center justify-center rounded-md text-sm font-medium transition-colors duration-fast outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[selected]:border data-[selected]:border-border data-[selected]:bg-background data-[selected]:shadow-sm',
)
export const PaginationPrevious = classPart(
  button,
  'inline-flex h-9 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-medium transition-colors duration-fast outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const PaginationNext = PaginationPrevious
export const PaginationEllipsis = classPart(
  span,
  'flex size-9 items-center justify-center text-muted-foreground',
)
