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
 * publishes `data-orientation` on one part, so both are expressed as variants of
 * a single recipe. The class strings per orientation are upstream's exactly:
 * `h-full w-2.5 border-l border-l-transparent` and
 * `h-2.5 flex-col border-t border-t-transparent`.
 */
export const ScrollAreaScrollbar = classPart(
  div,
  'flex touch-none p-px transition-colors select-none border-transparent data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent',
)
export const ScrollAreaThumb = classPart(div, 'relative flex-1 rounded-full bg-border')
export const ScrollAreaCorner = classPart(div, 'bg-transparent')
