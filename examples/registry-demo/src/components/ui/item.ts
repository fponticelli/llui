import { div, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, createVariantsPart } from '../../lib/utils'

/**
 * Item — the generic row: leading media, a title and description, trailing
 * actions. It is the shape behind list rows, settings entries and command
 * results, factored out so those do not each re-derive it.
 */
export const Item = createVariantsPart(div, {
  base: 'flex w-full items-center gap-4 rounded-md border border-transparent p-3 text-sm transition-colors duration-fast',
  variants: {
    variant: {
      default: '',
      outline: 'border-border',
      muted: 'bg-muted',
    },
    size: {
      default: 'p-3',
      sm: 'gap-3 p-2',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export const ItemMedia = classPart(
  div,
  'flex shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4',
)
export const ItemContent = classPart(div, 'flex min-w-0 flex-1 flex-col gap-0.5')
export const ItemTitle = classPart(div, 'flex items-center gap-2 text-sm font-medium leading-none')
export const ItemDescription = classPart(p, 'line-clamp-2 text-sm text-muted-foreground')
export const ItemActions = classPart(div, 'flex shrink-0 items-center gap-2')

/** A group of Items with dividers, e.g. a settings list. */
export function ItemGroup(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  return classPart(div, 'flex flex-col')(a0 as ElProps, a1)
}
