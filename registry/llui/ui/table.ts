import { caption, div, table as tableEl, tbody, td, th, thead, tr } from '@llui/dom'
import { classPart, customTag } from '@/lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn): shadcn's `Table` is not
 * just the `<table>` — it wraps it in the scrolling container too
 * (`data-slot="table-container"`, `relative w-full overflow-x-auto`).
 *
 * `TableContainer` and `Table` are TWO plain `classPart`s, spread with the
 * machine's own part bags exactly like every sibling in this file
 * (`TableContainer({ ...parts.viewport }, [Table({ ...parts.root }, [...])])`
 * — the pattern `@llui/components`' own README documents for the headless
 * `table`/`data-table` machines). This used to be ONE function taking a
 * `viewport?: ElProps` OPTION baked into its own prop bag, which needed a
 * hand-rolled `TableProps` type (a template-literal `on*` pattern index
 * signature plus a general one, two `any`s, both carrying an eslint-disable)
 * just to reject a bogus handler value the way `TableRow`/`ElProps` do for
 * free — a strictly weaker contract than every OTHER part in this file (#264
 * item 2). The "proper" fix per #264 review item 5 is to stop having a
 * `viewport` key in the prop bag AT ALL: `TableContainer`/`Table` are now
 * plain `ElProps` via `classPart`, identical in shape to `TableRow` — so the
 * precise `on*`-handler rejection is inherited from `ElProps` for free, same
 * as every sibling part, and the compile-time-only type GATE this file used
 * to carry (test code that `llui add table` had no business copying into a
 * consumer app) is no longer needed at all: `registry/test/table-props-
 * shape.test.ts` instead asserts structurally that neither part's props type
 * carries a `viewport` key or a catch-all `Record<string, unknown>`/`any`
 * index signature, so this can't silently regress back to either shape.
 */
export const TableContainer = classPart(div, 'relative w-full overflow-x-auto')
export const Table = classPart(
  tableEl,
  'group/table w-full caption-bottom text-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)

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
