import { button, div, label, select } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * Cascade select — skin for `@llui/components/cascade-select`. No shadcn
 * counterpart.
 *
 * The levels are NATIVE `<select>` elements, not the registry's `Select` (which
 * skins a different, anchored-listbox machine), so this recipe styles a real
 * form control and keeps the platform's own disclosure arrow. Replacing it with
 * a themed chevron means `appearance-none` plus a background image, and the
 * only way to write one as a Tailwind arbitrary value is a data-URI with every
 * space escaped as `_` — a long, brittle string that the class extractor splits
 * on if a single space survives (it did, first time). If the arrow must match
 * the theme, use the registry's `Select` and drive it from a listbox machine
 * rather than fighting a native control.
 *
 * A level that is not yet reachable has no `data-ready`. Styling that as
 * "muted" rather than hiding it keeps the row's width stable as the user works
 * down the chain — a disappearing level makes the whole control jump.
 */
export const CascadeSelect = classPart(
  div,
  'flex flex-wrap items-end gap-2 data-disabled:pointer-events-none data-disabled:opacity-50',
)
export const CascadeSelectLabel = classPart(
  label,
  'mb-1.5 block text-sm leading-none font-medium select-none',
)
export const CascadeSelectLevel = classPart(
  select,
  'h-9 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:text-sm dark:bg-input/30 not-data-ready:text-muted-foreground',
)
export const CascadeSelectClearTrigger = classPart(
  button,
  buttonVariants({ variant: 'ghost', size: 'sm' }),
)
