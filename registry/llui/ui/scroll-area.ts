import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * ScrollArea — skin for `@llui/components/scroll-area`. The custom scrollbar is
 * real DOM the package positions, so it looks the same in every browser; the
 * `viewport` keeps native scrolling and keyboard behaviour.
 */
export const ScrollArea = classPart(div, 'relative overflow-hidden')
export const ScrollAreaViewport = classPart(div, 'size-full overflow-auto rounded-[inherit]')
export const ScrollAreaContent = classPart(div, 'min-w-full')
export const ScrollAreaScrollbar = classPart(
  div,
  'flex touch-none p-px transition-colors duration-fast select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t border-transparent',
)
export const ScrollAreaThumb = classPart(div, 'relative flex-1 rounded-full bg-border')
export const ScrollAreaCorner = classPart(div, 'bg-transparent')
