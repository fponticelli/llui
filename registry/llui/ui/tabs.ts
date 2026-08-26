import { button, div } from '@llui/dom'
import { classPart, classPartWithDefaults } from '@/lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * The named groups are load-bearing and must stay: the trigger reads BOTH
 * `group/tabs` (for orientation) and `group/tabs-list` (for the `default` vs
 * `line` variant). Renaming or dropping either silently disables every
 * orientation- and variant-dependent rule on the trigger, with no error.
 *
 * `@llui/components/tabs` does not emit `data-variant`, so pass
 * `'data-variant': 'default'` (or `'line'`) on the list yourself.
 */
export const Tabs = classPart(div, 'group/tabs flex gap-2 data-[orientation=horizontal]:flex-col')
export const TabsList = classPartWithDefaults(
  div,
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none data-[variant=line]:bg-transparent',
  // shadcn defaults `variant="default"`; without it the active trigger's
  // `group-data-[variant=default]/tabs-list:` shadow matches nothing.
  { 'data-variant': 'default' },
)
export const TabsTrigger = classPart(
  button,
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100 dark:text-muted-foreground dark:hover:text-foreground dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)
export const TabsContent = classPart(div, 'flex-1 outline-none')
