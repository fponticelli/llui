import { div, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/** An INTERSECTION, not `interface … extends ElProps`: `ElProps` is itself an
 * intersection carrying an index signature, and an interface extending it drops
 * that signature — so `props.class` stops existing and every `data-*` / `aria-*`
 * key a caller spreads becomes an error. */
export type SeparatorProps = ElProps & {
  orientation?: 'horizontal' | 'vertical'
  /** Decorative separators are hidden from assistive tech (the default). Set
   * false when the rule genuinely separates two groups a screen-reader user
   * needs announced. */
  decorative?: boolean
}

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). Orientation is expressed
 * as a `data-orientation` variant rather than a class ternary, which is both
 * shadcn's shape and the form the repo's Tailwind check can read in full. */
export const separatorRecipe =
  'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px'

export function Separator(props?: SeparatorProps): Mountable {
  const { orientation = 'horizontal', decorative = true, class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    role: decorative ? 'none' : 'separator',
    'aria-orientation': decorative ? undefined : orientation,
    'data-orientation': orientation,
    class: mergeClass(separatorRecipe, className),
  })
}
