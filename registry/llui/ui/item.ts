import { div, p } from '@llui/dom'
import { classPart, createVariantsPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * Note `[a]:hover:bg-accent/50` — like Badge, an Item is only interactive when
 * it is a link, so the hover state is scoped to that rather than applied to
 * every row.
 */
export const Item = createVariantsPart(div, {
  base: 'group/item flex flex-wrap items-center rounded-md border border-transparent text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-accent/50',
  variants: {
    variant: {
      default: 'bg-transparent',
      outline: 'border-border',
      muted: 'bg-muted/50',
    },
    size: { default: 'gap-4 p-4', sm: 'gap-2.5 px-4 py-3' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export const ItemGroup = classPart(div, 'group/item-group flex flex-col')
export const ItemMedia = createVariantsPart(div, {
  base: 'flex shrink-0 items-center justify-center gap-2 group-has-[[data-part=item-description]]/item:translate-y-0.5 group-has-[[data-part=item-description]]/item:self-start [&_svg]:pointer-events-none',
  variants: {
    variant: {
      default: 'bg-transparent',
      icon: "size-8 rounded-sm border bg-muted [&_svg:not([class*='size-'])]:size-4",
      image: 'size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover',
    },
  },
  defaultVariants: { variant: 'default' },
})
export const ItemContent = classPart(
  div,
  'flex flex-1 flex-col gap-1 [&+[data-part=item-content]]:flex-none',
)
export const ItemTitle = classPart(
  div,
  'flex w-fit items-center gap-2 text-sm leading-snug font-medium',
)
export const ItemDescription = classPart(
  p,
  'line-clamp-2 text-sm leading-normal font-normal text-balance text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
)
export const ItemActions = classPart(div, 'flex items-center gap-2')
export const ItemSeparator = classPart(div, 'my-0')

/** Full-width rows above and below an Item's main line — upstream uses them for
 * a title bar and a meta strip inside the same card. */
export const ItemHeader = classPart(div, 'flex basis-full items-center justify-between gap-2')
export const ItemFooter = classPart(div, 'flex basis-full items-center justify-between gap-2')
