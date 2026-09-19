import type { ElProps, Mountable } from '@llui/dom'
import { icon as glyph, iconConfig } from '@llui/components/icon'
import { mergeClass } from '@/lib/utils'

/**
 * The icon set shadcn/ui's components render, loaded from Iconify by name.
 *
 * shadcn imports these from `lucide-react` and BAKES them into the components —
 * `SelectTrigger` renders its own chevron, `Checkbox` its own tick, `DialogClose`
 * its own ✕. A port that copies only the class recipes gets components with
 * `[&_svg]` sizing hooks and nothing to hook, which is exactly why our Select
 * once rendered as a bare box with a text arrow.
 *
 * The loading, batching and sanitizing live in `@llui/components/icon` — read
 * its header for the three costs (icons are ASYNC, they need the NETWORK, and
 * the response is UNTRUSTED MARKUP). This file is the shadcn-shaped surface
 * over it: a FACTORY per glyph (`CheckIcon()`), so a recipe renders an icon the
 * way upstream renders `<CheckIcon />`, plus the caller's `class` merged
 * through `mergeClass` so a Tailwind override wins over a recipe's default.
 *
 * The glyphs deliberately carry NO size class. Every recipe already sizes its
 * icons with `[&_svg:not([class*='size-'])]:size-4`, which applies only when
 * the icon has not sized itself — so leaving it off is what lets the recipe
 * win, and passing `class: 'size-3'` is what lets a caller override it.
 */

/** Where glyphs are fetched from. Re-exported from `@llui/components/icon`;
 *  point it at a self-hosted Iconify to drop the third-party CDN. */
export { iconConfig }

/**
 * An icon helper for one Iconify glyph, named `prefix:name` — for example
 * `icon('lucide:star')` or `icon('simple-icons:github')`.
 *
 * `extra` is a class the glyph always carries. Keep it OFF the size axis: the
 * recipes size icons, and a size here beats every one of them.
 */
export function icon(name: string, extra?: string): (props?: ElProps) => Mountable {
  return (props) => {
    const { class: className, ...rest } = props ?? {}
    return glyph(name, { ...rest, class: mergeClass(extra ?? '', className) })
  }
}

export const CheckIcon = icon('lucide:check')
export const ChevronDownIcon = icon('lucide:chevron-down')
export const ChevronUpIcon = icon('lucide:chevron-up')
export const ChevronRightIcon = icon('lucide:chevron-right')
export const ChevronLeftIcon = icon('lucide:chevron-left')
export const XIcon = icon('lucide:x')
export const MinusIcon = icon('lucide:minus')
export const SearchIcon = icon('lucide:search')
/**
 * The radio dot. Lucide's `circle` is STROKED, and upstream fills it from the
 * class side (`fill-primary` on shadcn's `RadioGroupItem`) rather than swapping
 * the glyph.
 *
 * The variant selector is load-bearing and `fill-current` alone does NOT work.
 * With `lucide-react` the `<circle>` has no fill of its own, so a `fill-*` on
 * the `<svg>` inherits down and fills it. Iconify's body puts `fill="none"` on
 * the element itself, and a presentation attribute on an element beats a value
 * INHERITED from its parent — so the class has to match the child directly.
 * Measured: with `fill-current` the dot rendered `fill: none` and the radio
 * showed a ring instead of a dot.
 */
export const CircleIcon = icon('lucide:circle', '[&>*]:fill-current')
export const GripVerticalIcon = icon('lucide:grip-vertical')
/** The spinner arc. Pair with `animate-spin`. */
export const LoaderIcon = icon('lucide:loader-circle')

// Nav glyphs. Not baked into any shadcn component — these exist because the
// Sidebar's icon rail is only legible with them: collapsed to `--sidebar-width-icon`
// a text-only menu button shows a truncated label, which is what upstream's
// `[&>span:last-child]:truncate` is there to clip AROUND an icon, not instead of one.
export const LayoutDashboardIcon = icon('lucide:layout-dashboard')
export const FolderIcon = icon('lucide:folder')
export const CalendarIcon = icon('lucide:calendar')
export const SettingsIcon = icon('lucide:settings-2')
