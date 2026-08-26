import { a, li, nav, ol, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Breadcrumb — skin for `@llui/components/breadcrumbs`. The current page's link
 * gets `data-current`, which the recipe uses to drop the underline and pointer;
 * the package also sets `aria-current="page"` on it.
 */
export const Breadcrumb = classPart(nav, '')
export const BreadcrumbList = classPart(
  ol,
  'flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5',
)
export const BreadcrumbItem = classPart(li, 'inline-flex items-center gap-1.5')
export const BreadcrumbLink = classPart(
  a,
  'transition-colors duration-fast hover:text-foreground data-[current]:font-medium data-[current]:text-foreground data-[current]:pointer-events-none data-[current]:no-underline',
)
export const BreadcrumbSeparator = classPart(span, 'text-muted-foreground [&_svg]:size-3.5')
export const BreadcrumbEllipsis = classPart(
  span,
  'flex size-9 items-center justify-center transition-colors duration-fast hover:text-foreground',
)
