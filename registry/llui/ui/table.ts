import { caption, div, table as tableEl, tbody, td, th, thead, tr } from '@llui/dom'
import { classPart, customTag, mergeClass, splitArgs } from '@/lib/utils'
import { type AttrValue, type ChildNode, type ElProps, type Mountable } from '@llui/dom'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn): shadcn's `Table` is not
 * just the `<table>` — it wraps it in the scrolling container too
 * (`data-slot="table-container"`, `relative w-full overflow-x-auto`).
 * `viewport` is an OPTION rather than a second exported component: pass the
 * headless machine's own `viewport` part bag (`table.connect(...).viewport`,
 * or `dataTable.connect(...).table.viewport`) and the container div IS that
 * part — never a second scrollport nested inside it. A bare `Table(...)` with
 * no `viewport` still renders shadcn's container, defaulted to
 * `data-part="table-container"`.
 *
 * `TableProps` is NOT `ElProps & { viewport?: ElProps }`: TypeScript requires
 * every property of an intersected object type to be individually assignable
 * to a SIBLING index signature in that same intersection, and `ElProps`'s own
 * index signature (`AttrValue | handler`) rejects an object value — so
 * `viewport?: ElProps` alongside `ElProps`'s index signature makes the
 * `viewport` KEY ITSELF a type error at every call site, regardless of how
 * the type is spelled (`extends` has the opposite, better-known failure mode:
 * it silently DROPS the index signature instead). The index signature here is
 * widened to `unknown` so `viewport`'s object value coexists with it; `rest`
 * is cast back to `ElProps` below since it is exactly that once `viewport`
 * and `class` are destructured out.
 */
export type TableProps = {
  viewport?: ElProps
  class?: AttrValue
} & Record<string, unknown>

export function Table(
  a0?: TableProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0 as ElProps | readonly ChildNode[] | undefined, a1)
  const { class: className, viewport, ...rest } = props as TableProps
  const { class: viewportClassName, ...viewportRest } = viewport ?? {}
  return div(
    {
      'data-part': 'table-container',
      ...viewportRest,
      class: mergeClass('relative w-full overflow-x-auto', viewportClassName),
    },
    [
      tableEl(
        {
          ...(rest as ElProps),
          class: mergeClass(
            'group/table w-full caption-bottom text-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            className,
          ),
        },
        children,
      ),
    ],
  )
}

export const TableHeader = classPart(thead, '[&_tr]:border-b')
export const TableBody = classPart(tbody, '[&_tr:last-child]:border-0')
// `<tfoot>` has no named helper in `@llui/dom`; `customTag` adapts `el` for it.
export const TableFooter = classPart(
  customTag('tfoot'),
  'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
)
export const TableRow = classPart(
  tr,
  'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[selected]:bg-muted aria-selected:bg-muted forced-colors:data-[selected]:outline-2 forced-colors:data-[selected]:outline-[Highlight] forced-colors:data-[selected]:-outline-offset-2 forced-colors:aria-selected:outline-2 forced-colors:aria-selected:outline-[Highlight] forced-colors:aria-selected:-outline-offset-2',
)
export const TableHead = classPart(
  th,
  'h-10 px-2 text-start align-middle font-medium whitespace-nowrap text-foreground outline-none group-data-[density=compact]/table:h-8 group-data-[density=compact]/table:px-1.5 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:-outline-offset-2 [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]',
)
export const TableCell = classPart(
  td,
  'p-2 text-start align-middle whitespace-nowrap outline-none group-data-[density=compact]/table:px-1.5 group-data-[density=compact]/table:py-1 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:-outline-offset-2 [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]',
)
export const TableCaption = classPart(caption, 'mt-4 text-sm text-muted-foreground')
