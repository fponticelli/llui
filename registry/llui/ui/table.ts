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
 * it silently DROPS the index signature instead).
 *
 * It is also NOT `{...} & Record<string, unknown>`: `unknown` absorbs EVERY
 * value, so `Table({ onClick: 42 })` compiled while the identical
 * `TableRow({ onClick: 42 })` (whose props ARE plain `ElProps`, via
 * `classPart`) correctly errored — the loose catch-all was silently a
 * strictly WEAKER contract than every sibling part in this file (#264 item
 * 2). `@llui/dom`'s `ElEventMap` (the mapped type backing `ElProps`'s precise
 * `on*` handlers) is not part of the package's public surface, so it cannot
 * be reused here directly; the fix instead adds a template-literal PATTERN
 * index signature for every `on*`-shaped key requiring a handler function,
 * alongside a second, more permissive index signature for everything else
 * (attributes/`data-*`/`aria-*` as `AttrValue`, or `viewport` as `ElProps`).
 * TypeScript allows a pattern index signature to coexist with a general
 * string index signature as long as the pattern one's value type stays
 * assignable to the general one's — which `(ev: any) => void` is, since it
 * is already one of the general index signature's union members. `rest` is
 * cast back to `ElProps` below since it is exactly that (module the widened
 * `viewport`/`ElProps` union member, which is impossible once `viewport` has
 * been destructured out) once `viewport` and `class` are destructured out.
 */
export type TableProps = {
  viewport?: ElProps
  class?: AttrValue
} & {
  [K in `on${string}`]?: (ev: any) => void // eslint-disable-line @typescript-eslint/no-explicit-any
} & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: AttrValue | ((ev: any) => void) | ElProps | undefined
}

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

/**
 * Compile-time-only gate (#264 item 2), never called at runtime: pins
 * `TableProps`' precision against a regression back to the `Record<string,
 * unknown>` catch-all it replaced, which silently accepted a bogus value for
 * a real handler prop. `pnpm check:registry` compiles this file, so a
 * widening of `TableProps` that makes the `@ts-expect-error` below stop being
 * an error fails the build (an unused `@ts-expect-error` is itself a `tsc`
 * error); the control line beside it proves the same call form still
 * compiles when the value is a real handler, so this is testing the TYPE,
 * not merely that the call form is rejected outright.
 */
const _tableTypeGate = (): void => {
  // @ts-expect-error TableProps must reject a non-function value for an `on*` key, exactly like TableRow/ElProps.
  Table({ onClick: 42 })
  // Control: a real handler for the same key compiles cleanly.
  Table({ onClick: () => {} })
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
