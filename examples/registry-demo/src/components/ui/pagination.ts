import {
  button,
  constant,
  derived,
  isSignalHandle,
  li,
  nav,
  span,
  ul,
  type AttrValue,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { classPart, cn, mergeClass, splitArgs } from '../../lib/utils'
import { buttonVariants } from './button'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), including the part people miss:
 * shadcn's `PaginationLink` is not its own recipe — it calls `buttonVariants()`
 * with `ghost` or `outline` depending on whether the page is current. Reusing
 * the button recipe is what keeps a pagination control looking like the rest of
 * the app's buttons; a hand-written copy drifts on the first button change.
 *
 * shadcn picks the variant ONCE, in a plain render function (`isActive` is a
 * boolean prop). `@llui/components/pagination` instead publishes `data-selected`
 * as a reactive Signal, so the SAME choice — `buttonVariants({ variant: value
 * === undefined ? 'ghost' : 'outline', size })` — has to be made inside a
 * `derived(...)` binding rather than once at build time: build-once views never
 * re-run, so a plain per-render `isActive ? … : …` would freeze the class at
 * whatever the page happened to be at mount. This used to be worked around with
 * a hand-typed `data-selected:`-prefixed copy of `outline`'s utility list (a
 * CSS-variant trick, since Tailwind can only see a LITERAL class string) — which
 * is exactly the copy that can drift the moment `outline` changes in `button.ts`
 * and did not (the two are unrelated files with no shared source). Calling
 * `buttonVariants` directly and swapping the WHOLE resolved string reactively
 * keeps this byte-identical to `Button({ variant: 'outline' | 'ghost' })` by
 * construction, with no separate literal to fall out of sync.
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
  const ghostClass = buttonVariants({ variant: 'ghost', size: defaultSize })
  const outlineClass = buttonVariants({ variant: 'outline', size: defaultSize })

  return (a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const { props, children } = splitArgs(a0, a1)
    const { class: className, 'data-selected': selected, ...rest } = props
    // Both operands may independently be reactive (`selected` always is, from
    // the machine; `className` is a caller override that could be too), so both
    // are normalized to signals and combined with ONE `derived` binding rather
    // than branching on which side is reactive — that would silently freeze the
    // class the moment the untested combination showed up.
    const selectedSignal = isSignalHandle(selected) ? selected : constant(selected)
    const classNameSignal = isSignalHandle(className) ? className : constant(className)
    // `cn(...)` takes `paginationSelectedForcedColorsRecipe` and `extra`
    // DIRECTLY as arguments (#264 review item 10) — the extractor reads
    // recipes only from named positions (`cn`/`mergeClass`/`classPart`
    // arguments, `createVariants`'s `base`/`variants`), never through a
    // template literal built one level away and passed as a plain variable
    // reference; the intermediate `staticExtra` string this used to build
    // put both consts outside that reach. The override merge routes through
    // the shared `mergeClass` instead of re-deriving `cn`'s own
    // string-or-undefined normalization inline.
    const resolvedClass: AttrValue = derived(
      selectedSignal,
      classNameSignal,
      (value, override) =>
        // `mergeClass`'s declared return type is the union `AttrValue` (it
        // returns a MAPPED signal when its OWN `override` argument is itself
        // reactive), but every value read out of a `derived` combiner is
        // already a plain, resolved value — `override` here can never be a
        // signal, so this call always takes `mergeClass`'s plain-string
        // branch. The cast reflects that runtime guarantee; `derived`'s own
        // combiner return type must be a plain value, not the wider union.
        mergeClass(
          cn(
            value === undefined ? ghostClass : outlineClass,
            paginationSelectedForcedColorsRecipe,
            'group-data-[disabled]/pagination:opacity-100',
            extra,
          ),
          override,
        ) as string,
    )
    return button(
      {
        type: 'button',
        ...rest,
        'data-selected': selected,
        class: resolvedClass,
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
//
// This is NOT a copy of anything in `button.ts` — it is pagination's OWN extra
// affordance, an outline ring around the current page that survives forced-
// colors mode even though `buttonVariants`'s outline/ghost swap above already
// changes the system-drawn border on its own.
const paginationSelectedForcedColorsRecipe =
  'forced-colors:data-selected:outline-solid forced-colors:data-selected:outline-2 forced-colors:data-selected:outline-[Highlight] forced-colors:data-selected:-outline-offset-2'
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
