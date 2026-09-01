import { button, li, nav, span, ul } from '@llui/dom'
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
 * `@llui/components/pagination` publishes reactive `data-selected` and
 * `aria-current` attributes. Page items stay real buttons: the machine's
 * roving-focus helper deliberately addresses buttons, and pagination here is
 * an in-app state change rather than document navigation.
 */
export const Pagination = classPart(
  nav,
  'group/pagination mx-auto flex min-w-0 w-full justify-center data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const PaginationContent = classPart(
  ul,
  'flex max-w-full flex-row flex-wrap items-center justify-center gap-1',
)
export const PaginationItem = classPart(li, '')

function paginationLink(
  defaultSize: 'icon' | 'default',
  extra = '',
  glyph?: { at: 'start' | 'end'; icon: (props?: ElProps) => Mountable },
) {
  return (a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const { props, children } = splitArgs(a0, a1)
    const { class: className, ...rest } = props
    // Never inspect `data-selected` here: a machine part supplies a Signal, and
    // any Signal object is truthy regardless of its live value. The state recipe
    // is selector-driven so the original reactive attribute reaches the DOM.
    return button(
      {
        type: 'button',
        ...rest,
        class: mergeClass(
          `${buttonVariants({ variant: 'ghost', size: defaultSize })} ${paginationSelectedRecipe} group-data-[disabled]/pagination:opacity-100 ${extra}`,
          className,
        ),
      },
      glyph === undefined
        ? children
        : glyph.at === 'start'
          ? [glyph.icon({ class: 'size-4 rtl:rotate-180' }), ...children]
          : [...children, glyph.icon({ class: 'size-4 rtl:rotate-180' })],
    )
  }
}

// Named `*Recipe` consts, not inline arguments: a class string passed as a
// function ARGUMENT sits in no position the repo's Tailwind check reads, so
// these went unverified until they were hoisted here.
const paginationSelectedRecipe =
  'data-selected:border data-selected:bg-background data-selected:shadow-xs data-selected:hover:bg-accent data-selected:hover:text-accent-foreground dark:data-selected:border-input dark:data-selected:bg-input/30 dark:data-selected:hover:bg-input/50 forced-colors:data-selected:outline-solid forced-colors:data-selected:outline-2 forced-colors:data-selected:outline-[Highlight] forced-colors:data-selected:-outline-offset-2'
const paginationPreviousRecipe = 'gap-1 px-2.5 sm:ps-2.5'
const paginationNextRecipe = 'gap-1 px-2.5 sm:pe-2.5'

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
