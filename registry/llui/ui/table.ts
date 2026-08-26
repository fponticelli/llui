import { caption, div, table as tableEl, tbody, td, th, thead, tr } from '@llui/dom'
import { type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, customTag, splitArgs } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
const tableInner = classPart(tableEl, 'w-full caption-bottom text-sm')

/**
 * Table — wrapped in an `overflow-x-auto` div, as shadcn's is, so a wide table
 * scrolls inside its own box instead of scrolling the page. The wrapper is part
 * of the component rather than the caller's job: a table that overflows the
 * viewport is the default failure mode of every hand-rolled version of this.
 */
export function Table(a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable {
  const { props, children } = splitArgs(a0, a1)
  return div({ class: 'relative w-full overflow-x-auto' }, [tableInner(props, children)])
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
  'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
)
export const TableHead = classPart(
  th,
  'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
)
export const TableCell = classPart(
  td,
  'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
)
export const TableCaption = classPart(caption, 'mt-4 text-sm text-muted-foreground')
