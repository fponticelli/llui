import { circle, path, svg, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/**
 * Spinner — `aria-hidden`, because the loading STATE belongs on the region it
 * describes (`aria-busy`, or a live region), not on the decoration. A spinner
 * that announces itself reads as "image" and tells the user nothing.
 *
 * Built from `@llui/dom`'s namespaced SVG helpers rather than `elNS`, so the
 * children are typed the same way every other element in this directory is.
 */
export function Spinner(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return svg(
    {
      ...rest,
      'aria-hidden': 'true',
      viewBox: '0 0 24 24',
      fill: 'none',
      class: mergeClass('size-4 animate-spin text-muted-foreground', className),
    },
    [
      circle({
        cx: '12',
        cy: '12',
        r: '10',
        stroke: 'currentColor',
        'stroke-width': '3',
        class: 'opacity-25',
      }),
      path({
        fill: 'currentColor',
        class: 'opacity-90',
        d: 'M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2Z',
      }),
    ],
  )
}
