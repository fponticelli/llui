import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Theme switch — skin for `@llui/components/theme-switch`. No shadcn
 * counterpart; shadcn's own docs use a dropdown, which this registry already
 * ships.
 *
 * Two presentations, both from the same machine: a segmented `option` row
 * (light / dark / system) and a single `toggle`. The pressed state comes from
 * `aria-pressed`, which is what the machine publishes — these are TOGGLE
 * BUTTONS, not tabs, so there is no `data-state` to key off and
 * `aria-pressed:` is the correct hook rather than a fallback.
 *
 * `data-theme` on an option names WHICH theme it selects, not which is active;
 * use it to place an icon, never to style the selection.
 */
export const ThemeSwitch = classPart(
  div,
  'inline-flex items-center gap-1 rounded-md border bg-background p-1 shadow-xs',
)
export const ThemeSwitchOption = classPart(
  button,
  "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-accent-foreground [&_svg:not([class*='size-'])]:size-4",
)
export const ThemeSwitchToggle = classPart(
  button,
  "inline-flex size-9 items-center justify-center rounded-md border bg-background text-foreground shadow-xs transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg:not([class*='size-'])]:size-4",
)
