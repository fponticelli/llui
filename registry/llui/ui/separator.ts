import { div, type ElProps, type Mountable } from '@llui/dom'
import { createVariants } from '@llui/components/styles'
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

/** A `createVariants` recipe rather than a template literal with a ternary in
 * it. Both render the same classes; only this one is fully readable by the
 * Tailwind check, which can extract a template literal's STATIC text but never
 * the classes hidden inside an interpolation. */
export const separatorVariants = createVariants({
  base: 'shrink-0 bg-border',
  variants: {
    orientation: { horizontal: 'h-px w-full', vertical: 'h-full w-px' },
  },
  defaultVariants: { orientation: 'horizontal' },
})

export function Separator(props?: SeparatorProps): Mountable {
  const { orientation = 'horizontal', decorative = true, class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    role: decorative ? 'none' : 'separator',
    'aria-orientation': decorative ? undefined : orientation,
    'data-orientation': orientation,
    class: mergeClass(separatorVariants({ orientation }), className),
  })
}
