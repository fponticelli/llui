import { button, div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's version drives spacing
 * from a `--gap` custom property and a `data-spacing` attribute; that is kept as
 * the `data-[spacing=0]` fused look, which is the one people reach for, with
 * shadcn's `group/toggle-group` name preserved so the item rules resolve.
 *
 * Pass `'data-variant': 'outline'` and `'data-spacing': '0'` on the root for the
 * segmented appearance — `@llui/components/toggle-group` emits neither.
 */
export const ToggleGroup = classPart(
  div,
  'group/toggle-group flex w-fit items-center rounded-md data-[spacing=default]:gap-1 data-[spacing=default]:data-[variant=outline]:shadow-xs',
)
export const ToggleGroupItem = classPart(
  button,
  "w-auto min-w-0 shrink-0 inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus:z-10 focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground group-data-[variant=outline]/toggle-group:border group-data-[variant=outline]/toggle-group:border-input group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:shadow-none group-data-[spacing=0]/toggle-group:first:rounded-l-md group-data-[spacing=0]/toggle-group:last:rounded-r-md group-data-[spacing=0]/toggle-group:group-data-[variant=outline]/toggle-group:border-l-0 group-data-[spacing=0]/toggle-group:first:group-data-[variant=outline]/toggle-group:border-l [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)
