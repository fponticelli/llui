import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** NavigationMenu — skin for `@llui/components/navigation-menu`. */
export const NavigationMenu = classPart(
  div,
  'relative flex max-w-max flex-1 items-center justify-center',
)
export const NavigationMenuList = classPart(div, 'flex flex-1 list-none items-center gap-1')
export const NavigationMenuTrigger = classPart(
  button,
  'inline-flex h-9 items-center justify-center gap-1 rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors duration-fast outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
)
export const NavigationMenuContent = classPart(
  div,
  'rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md transition-opacity duration-fast data-[state=closed]:opacity-0',
)
