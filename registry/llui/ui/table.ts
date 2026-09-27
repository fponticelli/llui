import { caption, div, table as tableEl, tbody, td, th, thead, tr } from '@llui/dom'
import { type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, customTag, mergeClass } from '@/lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn): shadcn's `Table` is not
 * just the `<table>` — it wraps it in the scrolling container too
 * (`data-slot="table-container"`, `relative w-full overflow-x-auto`).
 *
 * shadcn ships exactly ONE `Table` component, so a registry consumer copying
 * this file expects one `<Table>` in the recipe, not a `TableContainer` +
 * `Table` pair to remember to nest correctly (#264 review item 3 — this file
 * had drifted to the two-export split TWICE, each time chasing a typing
 * concern that a plain intersection type resolves without weakening
 * anything). `viewport` is the headless machine's `parts.viewport` bag
 * (`table.connect(...).viewport`, or `dataTable.connect(...).table.viewport`)
 * and the container div IS that part, spread verbatim — never a second
 * scrollport nested inside it. A bare `Table(...)` with no `viewport` still
 * renders shadcn's container and still scrolls horizontally with no machine
 * wired up at all.
 *
 * **`viewport` is a SEPARATE third argument, never a field on the attribute
 * props bag (#264 post-merge fix).** An earlier revision spelled it
 * `TableProps = ElProps & { viewport?: ElProps }`, reasoning that an
 * intersection of two separately-declared types does not force `viewport`'s
 * object value to conform to `ElProps`'s own string index signature the way
 * an `interface X extends ElProps` would. That reasoning covers how the TYPE
 * is *declared*, but not how a call site's own object LITERAL is checked
 * against it: assigning a fresh literal like `{ ...parts.root, viewport:
 * {...} }` to `TableProps` still fails, because TypeScript flattens an
 * intersection when checking a fresh literal's properties against
 * whichever index signature is reachable through ANY constituent — so every
 * property, including `viewport`, is checked against `ElProps`'s `AttrValue
 * | ((e: Event) => void) | undefined` index signature, and an object value
 * is neither. This was invisible in the registry's OWN suite (which never
 * assembles the object literal with an inline `viewport:` key the exact way
 * a demo does) and surfaced only once a DEMO package's own `tsc` finally ran
 * (no lane had run it before). The fix: `viewport` is a same-shaped
 * `ElProps`, but it travels as its OWN parameter — never intersected into
 * the attribute bag at all, so there is no shared index signature for a
 * fresh literal to be checked against in the first place.
 */
export type TableProps = ElProps

/** `Table`'s optional third argument. Kept as a named type (rather than an
 * inline object type at the call site) so a registry consumer's own call
 * sites read the same way this file's do. */
export interface TableOptions {
  /** The machine's `viewport` part bag, spread onto the SAME scrolling
   * container this always renders — never a second, nested scrollport. */
  viewport?: ElProps
}

// `Table` deliberately does NOT accept the leading-children-array shorthand
// every other part in this file does (`splitArgs`'s `tag(children)` form):
// `Array.isArray` narrows a union member to `any[]`, and TypeScript will not
// exclude an object type carrying a string index signature (`TableProps`,
// via `ElProps`) from the OTHER branch of that narrowing — so the two-form
// call shape is unreachable here without a cast (a real repro, not a
// suspicion: isolated and confirmed against `tsc --strict` directly). No
// call site in this repo passes `Table` a bare children array, so the
// precise fix is to not offer the ambiguous shape at all, `props` first.
export function Table(
  props: TableProps = {},
  children: readonly ChildNode[] = [],
  options: TableOptions = {},
): Mountable {
  const { viewport } = options
  const { class: className, ...rest } = props
  const { class: viewportClassName, ...viewportRest } = viewport ?? {}
  return div(
    {
      ...viewportRest,
      // Kept as a LITERAL string argument (never a named const) so
      // `scripts/lib/registry-classes.mjs`'s AST extractor — which only
      // reads recipes passed directly to a fixed set of call names — can
      // still see it; a const reference here silently dropped it from the
      // Tailwind dead-class/marker checks (#264 review item 7's own gate
      // run caught this).
      class: mergeClass('relative w-full overflow-x-auto', viewportClassName),
    },
    [
      tableEl(
        {
          ...rest,
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
