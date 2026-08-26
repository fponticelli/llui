import { circle, path, svg, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/**
 * The icon set shadcn/ui's components render.
 *
 * shadcn imports these from `lucide-react` and BAKES them into the components —
 * `SelectTrigger` renders its own chevron, `Checkbox` its own tick, `DialogClose`
 * its own ✕. A port that copies only the class recipes gets components with
 * `[&_svg]` sizing hooks and nothing to hook, which is exactly why our Select
 * rendered as a bare box with a text arrow while shadcn's has a proper chevron.
 *
 * These are the same Lucide glyphs, inlined: 24×24 viewBox, `currentColor`
 * stroke, width 2, round caps and joins. Inlined rather than depending on a
 * package because there is no framework-agnostic Lucide build that returns
 * `Mountable`s, and ten paths is less surface than an adapter.
 *
 * They deliberately carry NO size class. Every recipe already sizes its icons
 * with `[&_svg:not([class*='size-'])]:size-4`, which only applies when the icon
 * has not sized itself — so leaving it off is what lets the recipe win, and
 * passing `class: 'size-3'` is what lets a caller override it.
 */
function icon(
  children: (props?: ElProps) => readonly Mountable[],
  extra?: string,
): (props?: ElProps) => Mountable {
  return (props) => {
    const { class: className, ...rest } = props ?? {}
    return svg(
      {
        'aria-hidden': 'true',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        ...rest,
        class: mergeClass(extra ?? '', className),
      },
      children(),
    )
  }
}

export const CheckIcon = icon(() => [path({ d: 'M20 6 9 17l-5-5' })])
export const ChevronDownIcon = icon(() => [path({ d: 'm6 9 6 6 6-6' })])
export const ChevronUpIcon = icon(() => [path({ d: 'm18 15-6-6-6 6' })])
export const ChevronRightIcon = icon(() => [path({ d: 'm9 18 6-6-6-6' })])
export const ChevronLeftIcon = icon(() => [path({ d: 'm15 18-6-6 6-6' })])
export const XIcon = icon(() => [path({ d: 'M18 6 6 18' }), path({ d: 'm6 6 12 12' })])
export const MinusIcon = icon(() => [path({ d: 'M5 12h14' })])
export const SearchIcon = icon(() => [
  circle({ cx: '11', cy: '11', r: '8' }),
  path({ d: 'm21 21-4.3-4.3' }),
])
/** Filled, not stroked — it is the radio dot, so it inherits `fill-current`. */
export const CircleIcon = icon(
  () => [circle({ cx: '12', cy: '12', r: '10', fill: 'currentColor', stroke: 'none' })],
  'fill-current',
)
export const GripVerticalIcon = icon(() =>
  [
    [9, 12],
    [9, 5],
    [9, 19],
    [15, 12],
    [15, 5],
    [15, 19],
  ].map(([cx, cy]) =>
    circle({ cx: String(cx), cy: String(cy), r: '1', fill: 'currentColor', stroke: 'none' }),
  ),
)
/** The spinner arc. Pair with `animate-spin`. */
export const LoaderIcon = icon(() => [path({ d: 'M21 12a9 9 0 1 1-6.219-8.56' })])
