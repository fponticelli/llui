import { a, li, nav, span, ul } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { buttonVariants } from './button'
import { mergeClass, splitArgs } from '../../lib/utils'
import { type ChildNode, type ElProps, type Mountable } from '@llui/dom'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), including the part people miss:
 * shadcn's `PaginationLink` is not its own recipe — it calls `buttonVariants()`
 * with `ghost` or `outline` depending on whether the page is current. Reusing
 * the button recipe is what keeps a pagination control looking like the rest of
 * the app's buttons; a hand-written copy drifts on the first button change.
 *
 * `@llui/components/pagination` marks the current page with `data-selected`, so
 * the variant is chosen from that rather than from an `isActive` prop.
 */
export const Pagination = classPart(nav, 'mx-auto flex w-full justify-center')
export const PaginationContent = classPart(ul, 'flex flex-row items-center gap-1')
export const PaginationItem = classPart(li, '')

function paginationLink(defaultSize: 'icon' | 'default', extra = '') {
  return (a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const { props, children } = splitArgs(a0, a1)
    const { class: className, ...rest } = props
    // `data-selected` is a string attribute on the bag, so the variant is chosen
    // here rather than as a `data-[selected]:` utility — `buttonVariants` picks a
    // whole recipe, and Tailwind cannot swap one recipe for another by selector.
    const selected = rest['data-selected'] !== undefined && rest['data-selected'] !== false
    return a(
      {
        ...rest,
        'aria-current': selected ? 'page' : undefined,
        class: mergeClass(
          `${buttonVariants({ variant: selected ? 'outline' : 'ghost', size: defaultSize })} ${extra}`,
          className,
        ),
      },
      children,
    )
  }
}

export const PaginationLink = paginationLink('icon')
export const PaginationPrevious = paginationLink('default', 'gap-1 px-2.5 sm:pl-2.5')
export const PaginationNext = paginationLink('default', 'gap-1 px-2.5 sm:pr-2.5')
export const PaginationEllipsis = classPart(span, 'flex size-9 items-center justify-center')
