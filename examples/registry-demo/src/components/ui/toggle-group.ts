import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * Spacing comes from a `--gap` custom property read through
 * `gap-[--spacing(var(--gap))]`, paired with `data-spacing`. Set
 * `'data-spacing': '0'` and `[--gap:0]` for the fused segmented look (items lose
 * their inner radii and share a border), or `'default'` with a `--gap` for
 * separated pills. `@llui/components/toggle-group` emits neither attribute, so
 * pass `data-variant` and `data-spacing` yourself.
 */
export const ToggleGroup = classPart(
  div,
  'group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs',
)
export const ToggleGroupItem = classPart(
  button,
  "w-auto min-w-0 shrink-0 inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus:z-10 focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground group-data-[variant=outline]/toggle-group:border group-data-[variant=outline]/toggle-group:border-input data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)
