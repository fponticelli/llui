import { a, li, nav, ol, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * shadcn splits the current page into its own `BreadcrumbPage` component;
 * `@llui/components/breadcrumbs` marks it with `data-current` on the same link
 * part instead, so both looks live in one recipe as a `data-[current]:` variant.
 */
export const Breadcrumb = classPart(nav, '')
export const BreadcrumbList = classPart(
  ol,
  'flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5',
)
export const BreadcrumbItem = classPart(li, 'inline-flex items-center gap-1.5')
export const BreadcrumbLink = classPart(
  a,
  'transition-colors hover:text-foreground data-[current]:pointer-events-none data-[current]:font-normal data-[current]:text-foreground',
)
export const BreadcrumbPage = classPart(span, 'font-normal text-foreground')
export const BreadcrumbSeparator = classPart(li, '[&>svg]:size-3.5')
export const BreadcrumbEllipsis = classPart(span, 'flex size-9 items-center justify-center')
