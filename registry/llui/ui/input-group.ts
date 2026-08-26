import { div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, createVariantsPart, mergeClass, splitArgs } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * The GROUP owns the border and the focus ring; the inner control gives them up
 * (`[&>input]:border-0 … [&>input]:focus-visible:ring-0`). That is why the
 * recipe reaches into `[&>input]` rather than asking the caller to pass a
 * stripped Input — a focus ring drawn on the inner control would sit INSIDE the
 * group's border.
 */
export function InputGroup(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div(
    {
      ...rest,
      class: mergeClass(
        'group/input-group relative flex w-full items-center rounded-md border border-input shadow-xs transition-[color,box-shadow] outline-none h-9 min-w-0 has-[>textarea]:h-auto has-[>[data-align=inline-start]]:[&>input]:pl-2 has-[>[data-align=inline-end]]:[&>input]:pr-2 has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-[3px] has-[>input:focus-visible]:ring-ring/50 has-[>input[aria-invalid=true]]:border-destructive has-[>input[aria-invalid=true]]:ring-destructive/20 has-[>input:disabled]:cursor-not-allowed has-[>input:disabled]:opacity-50 dark:bg-input/30 [&>input]:h-full [&>input]:w-full [&>input]:min-w-0 [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-3 [&>input]:shadow-none [&>input]:outline-none [&>input]:focus-visible:border-0 [&>input]:focus-visible:ring-0 [&>input]:dark:bg-transparent',
        className,
      ),
    },
    children,
  )
}

export const InputGroupAddon = createVariantsPart(div, {
  base: "flex h-auto shrink-0 cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  variants: {
    align: {
      'inline-start': 'order-first pl-3',
      'inline-end': 'order-last pr-3',
      'block-start': 'order-first w-full justify-start px-3 pt-3',
      'block-end': 'order-last w-full justify-start px-3 pb-3',
    },
  },
  defaultVariants: { align: 'inline-start' },
})

export const InputGroupText = classPart(
  div,
  "flex items-center gap-2 text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
)
