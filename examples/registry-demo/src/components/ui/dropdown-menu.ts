import { button, div, span, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'
import { floatingOverlayMotionRecipe, floatingSyncMotionRecipe } from '../../lib/floating-motion'
import { ChevronRightIcon } from './icons'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn) with ONE systematic translation, and
 * it is the most important one in this directory:
 *
 *   shadcn:  focus:bg-accent focus:text-accent-foreground
 *   LLui:    data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground
 *
 * Radix moves real DOM focus onto the highlighted menu item, so `focus:` is how
 * shadcn styles it. `@llui/components/menu` keeps focus on the menu CONTENT and
 * tracks the highlight in state, publishing it as `data-highlighted` — which is
 * the accessible pattern (`aria-activedescendant`) and means `focus:` here would
 * never match anything. Every menu-like surface in this registry — dropdown,
 * context menu, menubar, select, combobox, command — carries the same swap.
 *
 * Also dropped: `max-h-(--radix-…-available-height)` and
 * `origin-(--radix-…-transform-origin)`, both written by Radix's positioner.
 *
 * `cursor-default`, not `cursor-pointer`: that is shadcn's choice for menu items
 * and matches native menus.
 */
export const DropdownMenuTrigger = classPart(button, '')
const dropdownMenuSurfaceRecipe =
  'max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto overscroll-contain wrap-break-word rounded-md border bg-popover p-1 text-popover-foreground forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]'
const dropdownInteractiveStateRecipe =
  'outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 forced-colors:data-[highlighted]:bg-[Highlight] forced-colors:data-[highlighted]:text-[HighlightText] forced-colors:data-[highlighted]:[outline:2px_solid_Highlight] forced-colors:data-[highlighted]:outline-offset-[-2px] forced-colors:data-[disabled]:text-[GrayText]'
export const DropdownMenuContent = classPart(
  div,
  `z-50 min-w-[8rem] shadow-md ${dropdownMenuSurfaceRecipe} ${floatingOverlayMotionRecipe}`,
)
export const DropdownMenuItem = classPart(
  div,
  `relative flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm wrap-break-word select-none data-[inset]:ps-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20 forced-colors:data-[variant=destructive]:text-[LinkText] forced-colors:data-[variant=destructive]:underline forced-colors:data-[variant=destructive]:decoration-2 data-[variant=destructive]:*:[svg]:text-destructive! [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground ${dropdownInteractiveStateRecipe}`,
)
export const DropdownMenuCheckboxItem = classPart(
  div,
  `relative flex min-w-0 cursor-default items-center gap-2 rounded-sm py-1.5 pe-2 ps-8 text-sm wrap-break-word select-none aria-checked:font-medium forced-colors:aria-checked:[outline:2px_solid_Highlight] forced-colors:aria-checked:outline-offset-[-2px] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 ${dropdownInteractiveStateRecipe}`,
)
export const DropdownMenuRadioItem = DropdownMenuCheckboxItem
export const DropdownMenuItemIndicator = classPart(
  span,
  'pointer-events-none absolute start-2 flex size-3.5 items-center justify-center',
)
export const DropdownMenuGroup = classPart(div, '')
export const DropdownMenuLabel = classPart(
  div,
  'px-2 py-1.5 text-sm font-medium wrap-break-word data-[inset]:ps-8',
)
export const DropdownMenuSeparator = classPart(div, '-mx-1 my-1 h-px bg-border')
export const DropdownMenuShortcut = classPart(
  span,
  'ms-auto shrink-0 text-xs tracking-widest text-muted-foreground',
)
const dropdownMenuSubTriggerRecipe = `flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm wrap-break-word select-none data-[inset]:ps-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground ${dropdownInteractiveStateRecipe}`

/** Renders its own trailing chevron, as shadcn's does — the affordance that says
 * "this opens a submenu" is part of the component, not the caller's job. */
export function DropdownMenuSubTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return div({ ...rest, class: mergeClass(dropdownMenuSubTriggerRecipe, className) }, [
    ...children,
    ChevronRightIcon({ class: 'ms-auto size-4 rtl:rotate-180' }),
  ])
}

/**
 * A submenu LEVEL is a synchronous boolean machine — `subContent`'s own
 * `data-state` is only ever `open`/`closed` (`openPath` membership), never
 * `opening`/`closing` — unlike the top-level `DropdownMenuContent` above,
 * which sits behind a real four-phase presence machine. `floatingSyncMotionRecipe`
 * is the twin recipe scoped to exactly that reachable vocabulary (#265 finding 5).
 */
export const DropdownMenuSubContent = classPart(
  div,
  `z-50 min-w-[8rem] shadow-lg ${dropdownMenuSurfaceRecipe} ${floatingSyncMotionRecipe}`,
)

/**
 * The positioning wrapper `menu.subOverlay` (`@llui/components/menu`) builds
 * around each open submenu LEVEL's content, anchored to that level's own
 * `subTrigger`. Bare on purpose: it carries no visual style of its own
 * (`DropdownMenuSubContent` inside it is the surface) — real floating
 * geometry attaches directly to `DropdownMenuSubContent` itself (the engine
 * only prefers an ancestor carrying `data-part="positioner"`, which this
 * `"subpositioner"` wrapper is not), so this class stays empty rather than
 * carrying inline positioning that would never be read.
 */
export const DropdownMenuSubPositioner = classPart(div, '')
