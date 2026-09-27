import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const ScrollArea = classPart(div, 'relative')
export const ScrollAreaViewport = classPart(
  div,
  'size-full rounded-[inherit] overflow-auto transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
)
export const ScrollAreaContent = classPart(div, 'min-w-full')
/**
 * shadcn splits the two orientations across separate renders; LLui's machine
 * publishes ONE scrollbar part per axis and distinguishes them with `data-axis`
 * (`'x'` / `'y'`), so both are expressed as variants of a single recipe. The
 * class strings per orientation are upstream's exactly:
 * `h-full w-2.5 border-l border-l-transparent` and
 * `h-2.5 flex-col border-t border-t-transparent`.
 *
 * BOTH spellings are bound, as in `resizable.ts`: `data-axis` is what
 * `@llui/components/scroll-area` actually publishes, `data-orientation` is what
 * a shadcn snippet pasted in will carry. Binding only the upstream spelling is
 * how this shipped first, and it is invisible in every check the repo runs — the
 * classes all compile, the parts all spread, and the thumb renders at ZERO
 * pixels because nothing ever gave the bar a width or height. Verify a skin by
 * rendering it, not by reading its CSS.
 *
 * The bar honours `data-visible`, which IS the machine's policy
 * (`'always'` / `'auto'` / `'hover'` / `'scroll'`, chosen at `init`): the
 * machine decides WHEN, the recipe only renders the decision
 * (`opacity-0 data-visible:opacity-100`). This used to be left to the call
 * site, so a consumer who forgot it got permanently visible bars whatever
 * policy they had asked for (#266).
 *
 * Three LLui additions stand in for what Radix does with injected inline
 * styles, which this machine does not write: the viewport hides the NATIVE
 * scrollbar (`[scrollbar-width:none]` + the WebKit pseudo-element — without it
 * every scroll area shows two scrollbars), and each bar is absolutely placed
 * along its edge (`inset-y-0 end-0` / `inset-x-0 bottom-0`, logical so the
 * vertical bar follows `dir="rtl"` to the left).
 */
export const ScrollAreaScrollbar = classPart(
  div,
  'absolute flex touch-none border-transparent p-px opacity-0 transition-[color,background-color,border-color,opacity] select-none motion-reduce:transition-none data-visible:opacity-100 data-[axis=x]:inset-x-0 data-[axis=x]:bottom-0 data-[axis=y]:inset-y-0 data-[axis=y]:end-0 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent data-[axis=y]:h-full data-[axis=y]:w-2.5 data-[axis=y]:border-l data-[axis=y]:border-l-transparent data-[axis=x]:h-2.5 data-[axis=x]:flex-col data-[axis=x]:border-t data-[axis=x]:border-t-transparent',
)
export const ScrollAreaThumb = classPart(
  div,
  'relative flex-1 rounded-full bg-border forced-color-adjust-none forced-colors:bg-[CanvasText]',
)
export const ScrollAreaCorner = classPart(div, 'absolute end-0 bottom-0 size-2.5 bg-transparent')

/**
 * shadcn renders one scrollbar component per orientation, so its class strings
 * are BARE (`h-full w-2.5 border-l border-l-transparent`) rather than variant-
 * prefixed. `ScrollAreaScrollbar` above covers both from one `data-orientation`,
 * which is the shape LLui's machine publishes; these two exist for a consumer
 * rendering the axes separately, and carry upstream's classes unprefixed.
 */
export const ScrollAreaScrollbarVertical = classPart(
  div,
  'flex touch-none p-px transition-colors select-none h-full w-2.5 border-l border-l-transparent',
)
export const ScrollAreaScrollbarHorizontal = classPart(
  div,
  'flex touch-none p-px transition-colors select-none h-2.5 flex-col border-t border-t-transparent',
)
