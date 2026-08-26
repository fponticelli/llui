import { button, div, ul } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). The `group` on the
 * trigger is what lets its chevron rotate from `data-[state=open]`. */
export const NavigationMenu = classPart(
  div,
  'group/navigation-menu relative flex max-w-max flex-1 items-center justify-center',
)
export const NavigationMenuList = classPart(
  ul,
  'group flex flex-1 list-none items-center justify-center gap-1',
)
export const NavigationMenuTrigger = classPart(
  button,
  'group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-[color,box-shadow] outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent/50 data-[state=open]:text-accent-foreground data-[state=open]:hover:bg-accent data-[state=open]:focus:bg-accent',
)
/**
 * shadcn renders the panel either into a shared VIEWPORT or inline beneath the
 * trigger, chosen by `data-viewport` on the root. The inline presentation is the
 * whole `group-data-[viewport=false]/navigation-menu:` block — it is what gives
 * the panel its own surface, border and animation when there is no viewport to
 * host them. LLui has no viewport element, so set `'data-viewport': 'false'` on
 * the root and this is the presentation you get.
 */
export const NavigationMenuContent = classPart(
  div,
  'top-0 left-0 w-full p-2 pr-2.5 md:absolute md:w-auto group-data-[viewport=false]/navigation-menu:top-full group-data-[viewport=false]/navigation-menu:mt-1.5 group-data-[viewport=false]/navigation-menu:overflow-hidden group-data-[viewport=false]/navigation-menu:rounded-md group-data-[viewport=false]/navigation-menu:border group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:shadow group-data-[viewport=false]/navigation-menu:duration-200 group-data-[viewport=false]/navigation-menu:data-[state=closed]:animate-out group-data-[viewport=false]/navigation-menu:data-[state=closed]:fade-out-0 group-data-[viewport=false]/navigation-menu:data-[state=closed]:zoom-out-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:animate-in group-data-[viewport=false]/navigation-menu:data-[state=open]:fade-in-0 group-data-[viewport=false]/navigation-menu:data-[state=open]:zoom-in-95',
)
export const NavigationMenuIndicator = classPart(
  div,
  'relative top-[1px] ml-1 size-3 transition duration-300 group-data-[state=open]:rotate-180',
)
