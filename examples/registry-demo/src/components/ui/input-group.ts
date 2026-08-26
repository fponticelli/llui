import {
  button,
  div,
  input,
  textarea,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { classPart, createVariantsPart, mergeClass, splitArgs } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten
 * to LLui's `data-part`.
 *
 * The GROUP owns the border, the focus ring and the invalid state; the inner
 * control gives them up. That inversion is the whole design, and it is driven by
 * `has-[]` on a `data-part=input-group-control` marker rather than by the tag —
 * which is why `InputGroupInput` and `InputGroupTextarea` exist as their own
 * parts and why the plain `Input` should NOT be used inside a group. A focus
 * ring drawn on the inner control would sit INSIDE the group's border.
 *
 * `data-align` on an addon repositions the whole group: `block-start` /
 * `block-end` turn it into a column and pad the control on that side.
 */
export function InputGroup(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div(
    {
      'data-part': 'input-group',
      ...rest,
      class: mergeClass(
        'group/input-group relative flex w-full items-center rounded-md border border-input shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30 h-9 min-w-0 has-[>textarea]:h-auto has-[>[data-align=inline-start]]:[&>input]:pl-2 has-[>[data-align=inline-end]]:[&>input]:pr-2 has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[[data-part=input-group-control]:focus-visible]:border-ring has-[[data-part=input-group-control]:focus-visible]:ring-[3px] has-[[data-part=input-group-control]:focus-visible]:ring-ring/50 has-[[data-part][aria-invalid=true]]:border-destructive has-[[data-part][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-part][aria-invalid=true]]:ring-destructive/40',
        className,
      ),
    },
    children,
  )
}

export const InputGroupAddon = createVariantsPart(div, {
  base: "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  variants: {
    align: {
      'inline-start': 'order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]',
      'inline-end': 'order-last pr-3 has-[>button]:mr-[-0.45rem] has-[>kbd]:mr-[-0.35rem]',
      'block-start':
        'order-first w-full justify-start px-3 pt-3 [.border-b]:pb-3 group-has-[>input]/input-group:pt-2.5',
      'block-end':
        'order-last w-full justify-start px-3 pb-3 [.border-t]:pt-3 group-has-[>input]/input-group:pb-2.5',
    },
  },
  defaultVariants: { align: 'inline-start' },
})

/** A button sized to sit inside the group without breaking its height. */
export const InputGroupButton = createVariantsPart(button, {
  base: 'flex items-center gap-2 text-sm shadow-none',
  variants: {
    size: {
      xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
      sm: 'h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5',
      'icon-xs': 'size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0',
      'icon-sm': 'size-8 p-0 has-[>svg]:p-0',
    },
  },
  defaultVariants: { size: 'xs' },
})

export const InputGroupText = classPart(
  div,
  "flex items-center gap-2 text-sm text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
)

/** The control. Carries `data-part=input-group-control`, which is what the
 * group's `has-[]` focus and invalid rules select on — a plain `Input` here
 * would draw its own ring inside the group's border. */
export function InputGroupInput(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return input({
    'data-part': 'input-group-control',
    ...rest,
    class: mergeClass(
      'flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent h-full w-full min-w-0 px-3 outline-none',
      className,
    ),
  })
}

export function InputGroupTextarea(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return textarea({
    'data-part': 'input-group-control',
    ...rest,
    class: mergeClass(
      'flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent w-full px-3 outline-none',
      className,
    ),
  })
}
