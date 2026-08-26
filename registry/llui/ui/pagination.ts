import { a, li, nav, span, ul } from '@llui/dom'
import { ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'
import { mergeClass, splitArgs } from '@/lib/utils'
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

function paginationLink(
  defaultSize: 'icon' | 'default',
  extra = '',
  glyph?: { at: 'start' | 'end'; icon: (props?: ElProps) => Mountable },
) {
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
      glyph === undefined
        ? children
        : glyph.at === 'start'
          ? [glyph.icon({ class: 'size-4' }), ...children]
          : [...children, glyph.icon({ class: 'size-4' })],
    )
  }
}

// Named `*Recipe` consts, not inline arguments: a class string passed as a
// function ARGUMENT sits in no position the repo's Tailwind check reads, so
// these went unverified until they were hoisted here.
const paginationPreviousRecipe = 'gap-1 px-2.5 sm:pl-2.5'
const paginationNextRecipe = 'gap-1 px-2.5 sm:pr-2.5'

export const PaginationLink = paginationLink('icon')
export const PaginationPrevious = paginationLink('default', paginationPreviousRecipe, {
  at: 'start',
  icon: ChevronLeftIcon,
})
export const PaginationNext = paginationLink('default', paginationNextRecipe, {
  at: 'end',
  icon: ChevronRightIcon,
})
export const PaginationEllipsis = classPart(span, 'flex size-9 items-center justify-center')
