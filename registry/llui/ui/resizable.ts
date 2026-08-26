import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Resizable — skin for `@llui/components/splitter`. shadcn's name is Resizable;
 * LLui's machine is `splitter`. Both are exported.
 *
 * The handle is deliberately larger than it looks: a 1px visual rule with an
 * `after:` pseudo-element widening the hit area, because a hairline drag target
 * is unusable on touch and only slightly better with a mouse.
 */
export const ResizablePanelGroup = classPart(
  div,
  'flex h-full w-full data-[orientation=vertical]:flex-col',
)
export const ResizablePanel = classPart(div, 'overflow-hidden')
export const ResizableHandle = classPart(
  div,
  'relative flex w-px items-center justify-center bg-border transition-colors duration-fast outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 hover:bg-border-hover focus-visible:ring-2 focus-visible:ring-ring data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:inset-x-0 data-[orientation=vertical]:after:top-1/2 data-[orientation=vertical]:after:h-3 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0 data-[resizing]:bg-primary',
)

export {
  ResizablePanelGroup as Splitter,
  ResizablePanel as SplitterPanel,
  ResizableHandle as SplitterResizeTrigger,
}
