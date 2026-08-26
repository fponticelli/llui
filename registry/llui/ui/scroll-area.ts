import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const ScrollArea = classPart(div, 'relative')
export const ScrollAreaViewport = classPart(
  div,
  'size-full rounded-[inherit] overflow-auto transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1',
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
 * The bar carries NO visibility of its own. `data-visible` publishes the
 * machine's policy (`'always'` / `'auto'` / `'hover'` / `'scroll'`) and a
 * consumer who wants shadcn's fade adds `opacity-0 data-visible:opacity-100`
 * at the call site — binding it here would impose one policy on every consumer,
 * and it is the machine's to decide.
 */
export const ScrollAreaScrollbar = classPart(
  div,
  'flex touch-none border-transparent p-px transition-colors select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent data-[axis=y]:h-full data-[axis=y]:w-2.5 data-[axis=y]:border-l data-[axis=y]:border-l-transparent data-[axis=x]:h-2.5 data-[axis=x]:flex-col data-[axis=x]:border-t data-[axis=x]:border-t-transparent',
)
export const ScrollAreaThumb = classPart(div, 'relative flex-1 rounded-full bg-border')
export const ScrollAreaCorner = classPart(div, 'bg-transparent')

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
