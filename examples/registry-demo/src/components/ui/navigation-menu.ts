import { a, button, div, ul } from '@llui/dom'
import { classPart } from '../../lib/utils'

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

/**
 * The shared VIEWPORT presentation — the alternative to rendering each panel
 * inline. shadcn sizes it from Radix's
 * `--radix-navigation-menu-viewport-{height,width}`; LLui's machine does not
 * publish those, so set them yourself if you use this path, or set
 * `'data-viewport': 'false'` on the root and let `NavigationMenuContent` carry
 * its own surface instead (the more common shape here).
 */
export const NavigationMenuViewportPositioner = classPart(
  div,
  'absolute top-full left-0 isolate z-50 flex justify-center',
)
export const NavigationMenuViewport = classPart(
  div,
  // `origin-top-center` is not a Tailwind utility — it compiles to nothing,
  // upstream included. `origin-top` is the real one with the same intent.
  'origin-top relative mt-1.5 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:zoom-in-90',
)

/** A link inside a panel. `data-active` is the current-page state, and the
 * `focus:` rules stay as `focus:` here — unlike the menu surfaces, a navigation
 * link IS focused for real. */
export const NavigationMenuLink = classPart(
  a,
  "flex flex-col gap-1 rounded-sm p-2 text-sm transition-all outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground data-[active=true]:hover:bg-accent data-[active=true]:focus:bg-accent [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
)

/**
 * The little arrow that tracks the open top-level trigger. Spread
 * `navigationMenu.connect(...).indicator` onto it and render it as a sibling of
 * `NavigationMenuList`, inside `NavigationMenu` (which is `relative`).
 *
 * `top-full z-[1] flex h-1.5 …` onward is shadcn's recipe verbatim: the
 * animation and the arrow's box, and nothing else. Upstream needs nothing else
 * because Radix's `NavigationMenuIndicator` primitive supplies the POSITIONING
 * as an inline style (`position:absolute; left:0;
 * width:var(--radix-…-indicator-size);
 * transform:translateX(var(--radix-…-indicator-position))`).
 *
 * LLui has no such primitive, so the LEADING utilities are that inline style
 * expressed as classes, reading the custom properties
 * `navigationMenu.watchNavMenuIndicator(root)` writes. Without them the arrow
 * sits pinned at the list's left edge at its own intrinsic width — the same
 * gap `positionerClass` closes for `overlay()`. The `translate`/`width` half of
 * the transition is the slide between triggers, which upstream also gets from
 * Radix.
 *
 * THE HIDDEN STATE IS A DELIBERATE DEVIATION, and it is forced. Upstream's
 * pair is `data-[state=hidden]:animate-out data-[state=hidden]:fade-out`, which
 * works there because Radix UNMOUNTS the indicator once the exit animation
 * finishes — `hidden` is a transient state it passes through, never one it
 * rests in. This part stays MOUNTED (nothing here can unmount a node after its
 * own exit animation), so `hidden` IS the resting state, and a CSS animation
 * with the default `animation-fill-mode: none` releases its hold the moment it
 * ends. Measured on the rendered page: the arrow faded out and then snapped
 * back to `opacity: 1`, fully visible with `data-state="hidden"`. Applying the
 * animation on top of a static `opacity-0` fixes the rest but then plays the
 * exit ONCE AT MOUNT, flashing the arrow in on every page load.
 *
 * So the visibility is driven from the CASCADE — `opacity-0`, raised by
 * `data-[state=visible]:opacity-100` — with `transition-opacity` supplying the
 * fade. Both states are then correct at rest and there is nothing to play at
 * mount. Upstream's two `visible` classes are kept as-is: `animate-in fade-in`
 * composes correctly with a cascade that already resolves to `opacity-100`.
 */
export const NavigationMenuIndicatorTrack = classPart(
  div,
  'absolute left-0 w-(--indicator-width) translate-x-(--indicator-left) opacity-0 transition-[translate,width,opacity] duration-200 data-[state=visible]:opacity-100 top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden data-[state=visible]:animate-in data-[state=visible]:fade-in',
)
export const NavigationMenuIndicatorArrow = classPart(
  div,
  'relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md',
)
