import { caption, div, table as tableEl, tbody, td, th, thead, tr } from '@llui/dom'
import { classPart, customTag } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const Table = classPart(
  tableEl,
  'group/table w-full caption-bottom text-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)

/**
 * Owned table viewport. Spread `table.connect(...).viewport` here and place the
 * native `Table` directly inside. Keeping the two public parts separate lets
 * the headless contract own overflow without nesting a second scrollport inside
 * the registry skin.
 */
export const TableViewport = classPart(div, 'relative w-full overflow-x-auto')

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
