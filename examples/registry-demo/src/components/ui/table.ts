import {
  caption,
  div,
  table as tableEl,
  tbody,
  td,
  th,
  thead,
  tr,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { classPart, splitArgs } from '../../lib/utils'

const tableInner = classPart(tableEl, 'w-full caption-bottom text-sm')

/**
 * Table — wrapped in an `overflow-x-auto` div so a wide table scrolls inside its
 * own box instead of scrolling the page. The wrapper is part of the component,
 * not the caller's job, because a table that overflows the viewport is the
 * default failure mode of every hand-rolled version of this.
 */
export function Table(a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable {
  const { props, children } = splitArgs(a0, a1)
  return div({ class: 'relative w-full overflow-x-auto' }, [tableInner(props, children)])
}

export const TableHeader = classPart(thead, '[&_tr]:border-b [&_tr]:border-border')
export const TableBody = classPart(tbody, '[&_tr:last-child]:border-0')
export const TableRow = classPart(
  tr,
  'border-b border-border transition-colors duration-fast hover:bg-muted data-[state=selected]:bg-muted',
)
export const TableHead = classPart(
  th,
  'h-10 px-2 text-left align-middle font-medium text-muted-foreground',
)
export const TableCell = classPart(td, 'p-2 align-middle')
export const TableCaption = classPart(caption, 'mt-4 text-sm text-muted-foreground')
