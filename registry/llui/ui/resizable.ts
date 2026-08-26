import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's name is Resizable; LLui's
 * machine is `splitter`. Both are exported.
 *
 * shadcn keys orientation off `aria-[orientation=…]` because react-resizable-
 * panels writes it; `@llui/components/splitter` publishes `data-orientation`,
 * so the variants are bound to that instead — the one translation here.
 *
 * The handle's `after:` pseudo-element is not decoration: it widens a 1px visual
 * rule into a usable drag target. A hairline hit area is unusable on touch and
 * only slightly better with a mouse.
 */
export const ResizablePanelGroup = classPart(
  div,
  'flex h-full w-full data-[orientation=vertical]:flex-col',
)
export const ResizablePanel = classPart(div, 'overflow-hidden')
export const ResizableHandle = classPart(
  div,
  'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:translate-x-0 data-[orientation=vertical]:after:-translate-y-1/2 [&[data-orientation=vertical]>div]:rotate-90',
)
/** The optional grip shadcn renders inside the handle. */
export const ResizableHandleGrip = classPart(
  div,
  'z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border',
)

export {
  ResizablePanelGroup as Splitter,
  ResizablePanel as SplitterPanel,
  ResizableHandle as SplitterResizeTrigger,
}
