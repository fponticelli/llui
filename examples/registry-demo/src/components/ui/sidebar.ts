import {
  a,
  button,
  div,
  li,
  span,
  ul,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { classPart, createVariantsPart, mergeClass, splitArgs } from '../../lib/utils'

/**
 * Sidebar — ported verbatim from shadcn/ui (MIT © 2023 shadcn), with
 * `data-slot` rewritten to LLui's `data-part`.
 *
 * shadcn's version is a React CONTEXT plus a cookie-backed open/closed state. It
 * is not ported as state: `@llui/components/collapsible` (or a slice of your own
 * app state) already owns "is it open", and a TEA app should keep that where the
 * rest of its state lives rather than in a component-local context. What this
 * file provides is the whole PRESENTATION, driven by four attributes you set on
 * the root:
 *
 *   data-state="expanded" | "collapsed"
 *   data-collapsible="offcanvas" | "icon" | ""   (only while collapsed)
 *   data-variant="sidebar" | "floating" | "inset"
 *   data-side="left" | "right"
 *
 * Everything downstream reads those through the `group`/`peer` names, which is
 * why they must be preserved exactly: `group/sidebar-wrapper`, `group peer` on
 * the root, `peer/menu-button`, `group/menu-item`. Renaming one silently drops
 * every rule keyed to it.
 *
 * The widths are custom properties so one declaration resizes the whole thing:
 * set `--sidebar-width` (16rem), `--sidebar-width-icon` (3rem) and, for the
 * mobile sheet, `--sidebar-width-mobile` (18rem) on the wrapper.
 *
 * The `--sidebar*` COLOUR tokens ship in `@llui/components/styles/tokens.css`.
 */
export const SidebarProvider = classPart(
  div,
  'group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar',
)

/**
 * The gap the fixed panel leaves behind in the flow.
 *
 * Its width collapses from the ROOT's `data-collapsible`, not from a class the
 * caller swaps. That matters: two width utilities on one element are arbitrated
 * by stylesheet order, not by which one the caller passed last, and
 * `tailwind-merge` does not recognise `w-(--custom-property)` as a width to
 * de-duplicate. A reactive `class` here silently does nothing.
 *
 * The `floating` / `inset` variants add a `--spacing(4)` allowance because those
 * presentations sit inside a margin.
 */
export const SidebarGap = classPart(
  div,
  'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[collapsible=offcanvas]:w-0 group-data-[side=right]:rotate-180 group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[variant=floating]:group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))] group-data-[variant=inset]:group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]',
)

/** The outer, non-visual wrapper. `group peer` is what every sibling and
 * descendant rule keys off — `peer-data-[variant=inset]` on the inset container,
 * `group-data-[collapsible=icon]` throughout. */
export const Sidebar = classPart(div, 'group peer hidden text-sidebar-foreground md:block')

export const SidebarContainer = classPart(
  div,
  'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:left-0 group-data-[side=left]:border-r group-data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] group-data-[side=right]:right-0 group-data-[side=right]:border-l group-data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
)
export const SidebarInner = classPart(
  div,
  'flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm',
)

/** The mobile presentation — spread these onto a `Sheet` content. */
export const SidebarMobile = classPart(
  div,
  'w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden flex h-full w-full flex-col',
)

/** The thin drag/click strip on the sidebar's edge. */
export const SidebarRail = classPart(
  button,
  'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar',
)

/** The main content area beside the sidebar. */
export const SidebarInset = classPart(
  div,
  'relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
)

export const SidebarInput = classPart(div, 'h-8 w-full bg-background shadow-none')
export const SidebarHeader = classPart(div, 'flex flex-col gap-2 p-2')
export const SidebarFooter = classPart(div, 'flex flex-col gap-2 p-2')
export const SidebarSeparator = classPart(div, 'mx-2 w-auto bg-sidebar-border h-px')
export const SidebarContent = classPart(
  div,
  'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
)

export const SidebarGroup = classPart(div, 'relative flex w-full min-w-0 flex-col p-2')
export const SidebarGroupLabel = classPart(
  div,
  'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
)
export const SidebarGroupAction = classPart(
  button,
  'absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 after:absolute after:-inset-2 md:after:hidden group-data-[collapsible=icon]:hidden',
)
export const SidebarGroupContent = classPart(div, 'w-full text-sm')

export const SidebarMenu = classPart(ul, 'flex w-full min-w-0 flex-col gap-1')
export const SidebarMenuItem = classPart(li, 'group/menu-item relative')

/**
 * The row. `peer/menu-button` is read by `SidebarMenuAction` and
 * `SidebarMenuBadge`; `group-has-data-[sidebar=menu-action]/menu-item:pr-8`
 * reserves room for a trailing action only when one is present.
 *
 * Note `size-8!` / `p-2!` in the icon-collapsed state: the `!` is load-bearing,
 * because it has to beat the size variant on the same element.
 */
export const SidebarMenuButton = createVariantsPart(
  button,
  {
    base: 'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[part=sidebar-menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline:
          'bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
  // shadcn defaults `size="default"` as a prop, and `SidebarMenuBadge` reads it
  // off the DOM through `peer-data-[size=default]/menu-button:top-1.5` — a
  // variant resolved to a class leaves nothing there for the peer to match, so
  // without this the badge falls to its static position.
  { 'data-size': 'default' },
)

export const SidebarMenuAction = classPart(
  button,
  'absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 after:absolute after:-inset-2 md:after:hidden peer-data-[size=sm]/menu-button:top-1 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 group-data-[collapsible=icon]:hidden',
)
/** Only visible on hover / focus-within on desktop. */
export const SidebarMenuActionOnHover = classPart(
  span,
  'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground data-[state=open]:opacity-100 md:opacity-0',
)
export const SidebarMenuBadge = classPart(
  div,
  'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground peer-data-[size=sm]/menu-button:top-1 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 group-data-[collapsible=icon]:hidden',
)
export const SidebarMenuSkeleton = classPart(div, 'flex h-8 items-center gap-2 rounded-md px-2')
/** `--skeleton-width` lets a caller vary the bar length per row so a loading
 * list does not read as a set of identical stripes. */
export const SidebarMenuSkeletonText = classPart(div, 'h-4 max-w-(--skeleton-width) flex-1')

export const SidebarMenuSub = classPart(
  ul,
  'mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden',
)
export const SidebarMenuSubItem = classPart(li, 'group/menu-sub-item relative')
export const SidebarMenuSubButton = classPart(
  a,
  'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden',
)

/** The trigger that toggles the sidebar. Wire it to whatever holds the open
 * state and flip `data-state` on the root. */
export function SidebarTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return button(
    {
      type: 'button',
      'aria-label': 'Toggle Sidebar',
      ...rest,
      class: mergeClass('size-7', className),
    },
    children,
  )
}
